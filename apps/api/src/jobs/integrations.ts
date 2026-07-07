import type { IcpFilter } from "../../../../packages/schemas/index.js";
import { getHeroIcpFilter } from "../../../../packages/hero-config/index.js";
import type { Db } from "./db.js";
import type { InboundReply } from "./types.js";
import { serperSearchProspects } from "./serper.js";

const APOLLO_BASE = "https://api.apollo.io/api/v1";
const RESEND_BASE = "https://api.resend.com";

export interface Prospect {
  externalId: string;
  companyName: string;
  domain: string;
  industry: string | null;
  employeeCount: number | null;
  country: string | null;
  contactEmail: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  contactTitle: string | null;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  tags?: Record<string, string>;
  replyTo?: string;
}

export interface SendEmailResult {
  messageId: string;
}

function isMockMode(): boolean {
  return process.env.MOCK_INTEGRATIONS === "true";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value && !isMockMode()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value ?? "";
}

// ---------------------------------------------------------------------------
// Apollo — lead search + enrichment
// ---------------------------------------------------------------------------

export const enrichCompany = {
  async searchProspects(filter: IcpFilter, limit: number): Promise<Prospect[]> {
    if (isMockMode()) {
      return mockProspects(limit);
    }

    // Prefer Serper (cheap Google Places search) when configured;
    // fall back to Apollo for structured B2B contacts.
    if (process.env.SERPER_API_KEY) {
      return serperSearchProspects(filter, limit);
    }

    if (!process.env.APOLLO_API_KEY) {
      throw new Error(
        "No lead source configured: set SERPER_API_KEY or APOLLO_API_KEY (or MOCK_INTEGRATIONS=true)",
      );
    }

    const apiKey = requireEnv("APOLLO_API_KEY");

    const body: Record<string, unknown> = {
      page: 1,
      per_page: Math.min(limit, 25),
      person_titles: filter.titles ?? getHeroIcpFilter().titles ?? [
        "Founder",
        "CEO",
        "Head of Operations",
        "Director of Client Services",
      ],
      q_organization_keyword_tags:
        filter.industries ?? getHeroIcpFilter().industries ?? ["seo", "marketing agency"],
    };

    if (filter.minEmployees) body.organization_num_employees_ranges = [`${filter.minEmployees},${filter.maxEmployees ?? 500}`];
    if (filter.countries) body.person_locations = filter.countries;

    const res = await fetch(`${APOLLO_BASE}/mixed_people/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Apollo search failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as ApolloSearchResponse;

    return (data.people ?? [])
      .filter((person) => {
        const domain = person.organization?.primary_domain;
        if (!domain) return false;
        if (filter.excludeDomains?.includes(domain)) return false;
        return true;
      })
      .map((person) => ({
        externalId: person.id,
        companyName: person.organization?.name ?? "Unknown",
        domain: person.organization?.primary_domain ?? "",
        industry: person.organization?.industry ?? null,
        employeeCount: person.organization?.estimated_num_employees ?? null,
        country: person.country ?? person.organization?.country ?? null,
        contactEmail: person.email ?? null,
        contactFirstName: person.first_name ?? null,
        contactLastName: person.last_name ?? null,
        contactTitle: person.title ?? null,
      }));
  },

  async enrichDomain(domain: string): Promise<Partial<Prospect>> {
    if (isMockMode() || !process.env.APOLLO_API_KEY) {
      return { domain, companyName: domain.split(".")[0] };
    }

    const apiKey = requireEnv("APOLLO_API_KEY");
    const res = await fetch(`${APOLLO_BASE}/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
      headers: { "X-Api-Key": apiKey },
    });

    if (!res.ok) return { domain };

    const data = (await res.json()) as { organization?: ApolloOrganization };
    const org = data.organization;
    if (!org) return { domain };

    return {
      domain,
      companyName: org.name,
      industry: org.industry ?? null,
      employeeCount: org.estimated_num_employees ?? null,
      country: org.country ?? null,
    };
  },
};

interface ApolloSearchResponse {
  people?: ApolloPerson[];
}

interface ApolloPerson {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  title?: string;
  country?: string;
  organization?: ApolloOrganization;
}

interface ApolloOrganization {
  name?: string;
  primary_domain?: string;
  industry?: string;
  estimated_num_employees?: number;
  country?: string;
}

function mockProspects(limit: number): Prospect[] {
  const samples = [
    {
      externalId: "mock-hvac-1",
      companyName: "Summit Comfort HVAC",
      domain: "summitcomfort-hvac.example",
      industry: "HVAC",
      employeeCount: 24,
      country: "US",
      contactEmail: "mike.owner@summitcomfort-hvac.example",
      contactFirstName: "Mike",
      contactLastName: "Torres",
      contactTitle: "Owner",
    },
    {
      externalId: "mock-hvac-2",
      companyName: "CoolBreeze Home Services",
      domain: "coolbreeze-hs.example",
      industry: "Home Services",
      employeeCount: 18,
      country: "US",
      contactEmail: "lisa@coolsbreeze-hs.example",
      contactFirstName: "Lisa",
      contactLastName: "Nguyen",
      contactTitle: "General Manager",
    },
    {
      externalId: "mock-hvac-3",
      companyName: "Arctic Air Mechanical",
      domain: "arcticair.example",
      industry: "HVAC",
      employeeCount: 42,
      country: "US",
      contactEmail: "dan@arcticair.example",
      contactFirstName: "Dan",
      contactLastName: "Foster",
      contactTitle: "Operations Manager",
    },
  ];
  return samples.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Resend — outbound email
// ---------------------------------------------------------------------------

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (isMockMode() || !process.env.RESEND_API_KEY) {
    const messageId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[mock-email] To: ${input.to} | Subject: ${input.subject}`);
    console.log(`[mock-email] Body: ${input.text.slice(0, 120)}...`);
    return { messageId };
  }

  const apiKey = requireEnv("RESEND_API_KEY");
  const from = requireEnv("RESEND_FROM_EMAIL");

  const res = await fetch(`${RESEND_BASE}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
      reply_to: input.replyTo ?? process.env.RESEND_REPLY_TO,
      tags: input.tags
        ? Object.entries(input.tags).map(([name, value]) => ({ name, value }))
        : undefined,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend send failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { id: string };
  return { messageId: data.id };
}

// ---------------------------------------------------------------------------
// Inbound replies — read from DB queue (populated by webhook)
// ---------------------------------------------------------------------------

export async function fetchInboundReplies(since: Date, limit: number): Promise<InboundReply[]> {
  // This function is called with db in replyTriageJob — re-export a factory instead
  void since;
  void limit;
  throw new Error("Use fetchInboundRepliesFromDb(db, since, limit) instead");
}

export async function fetchInboundRepliesFromDb(
  db: Db,
  since: Date,
  limit: number,
): Promise<InboundReply[]> {
  return db.inboundQueue.fetchUnprocessed(since, limit);
}

// ---------------------------------------------------------------------------
// Resend webhook handler
// ---------------------------------------------------------------------------

export interface ResendWebhookEvent {
  type: string;
  data: {
    email_id?: string;
    from?: string;
    to?: string[];
    subject?: string;
    text?: string;
    html?: string;
    headers?: Record<string, string>;
    tags?: Record<string, string>;
  };
}

export async function handleResendWebhook(db: Db, event: ResendWebhookEvent): Promise<void> {
  if (event.type !== "email.received") return;

  const data = event.data;
  const fromEmail = extractEmail(data.from ?? "");
  const providerId = data.email_id ?? `inbound_${Date.now()}`;
  const bodyText = data.text ?? stripHtml(data.html ?? "");

  let contactId: string | null = null;
  let campaignId: string | null = data.tags?.campaignId ?? null;

  const contact = await db.contacts.findByEmail(fromEmail);
  if (contact) contactId = contact.id;

  await db.inboundQueue.enqueue({
    fromEmail,
    toEmail: data.to?.[0],
    subject: data.subject ?? "(no subject)",
    bodyText,
    providerId,
    threadId: data.headers?.["in-reply-to"] ?? data.headers?.["references"] ?? null,
    campaignId,
    contactId,
  });

  if (contact) {
    await db.contacts.update(contact.id, { status: "replied" });
  }
}

function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match?.[1] ?? raw).trim().toLowerCase();
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
