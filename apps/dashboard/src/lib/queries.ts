import { getDb } from "./db";
import { parseProductCacAssumptions } from "../../../../packages/economics/cac";
import type { RepoIntelligenceRecord } from "../../../../packages/repo-intelligence/types";
import {
  getGlobalCacDefaults as loadGlobalCacDefaults,
  type GlobalCacDefaults,
} from "../../../../packages/economics/cac-defaults";

export interface PipelineContact {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  status: string;
  leadScore: number | null;
  companyName: string;
  domain: string;
  icpScore: number | null;
  productSlug: string | null;
  productName: string | null;
}

export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  laymanPitch: string | null;
  status: string;
  repo: string | null;
  priceCents: number | null;
  billing: string | null;
  landingPath: string | null;
  contactCount: number;
  cacAssumptions: import("../../../../packages/economics/cac").ProductCacAssumptions;
  intelligence: import("../../../../packages/repo-intelligence/types").RepoIntelligenceRecord | null;
}

export interface ApprovalItem {
  id: string;
  action: string;
  agentId: string;
  reason: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
  contactEmail: string | null;
  contactName: string | null;
  companyName: string | null;
}

export interface DashboardMetrics {
  emailsSent: number;
  replies: number;
  meetingsBooked: number;
  pendingApprovals: number;
  totalContacts: number;
}

export interface WeeklyMetrics {
  emailsSent: number;
  replies: number;
  meetingsBooked: number;
}

export interface ActivityRow {
  id: string;
  type: string;
  agentId: string | null;
  subject: string | null;
  body: string | null;
  contactEmail: string | null;
  companyName: string | null;
  occurredAt: Date;
}

export interface ContactDetail {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  status: string;
  leadScore: number | null;
  leadScoreReason: string | null;
  companyName: string;
  domain: string;
  icpScore: number | null;
  activities: ActivityRow[];
}

export const PIPELINE_COLUMNS: { key: string; label: string; statuses: string[] }[] = [
  { key: "lead", label: "Lead", statuses: ["new", "enriched", "scored"] },
  { key: "queued", label: "Queued", statuses: ["queued"] },
  { key: "outreach", label: "Outreach", statuses: ["contacted"] },
  { key: "engaged", label: "Engaged", statuses: ["replied", "interested", "objection", "not_now"] },
  { key: "meeting", label: "Meeting", statuses: ["meeting_booked", "qualified", "proposal_sent"] },
  { key: "closed", label: "Closed", statuses: ["won", "lost", "disqualified", "unsubscribed", "bounced"] },
];

export async function getPipelineContacts(productSlug?: string): Promise<PipelineContact[]> {
  const db = getDb();
  try {
    const rows = await db.sql<
      {
        id: string;
        first_name: string | null;
        last_name: string | null;
        email: string;
        status: string;
        lead_score: number | null;
        company_name: string;
        domain: string;
        icp_score: number | null;
        product_slug: string | null;
        product_name: string | null;
      }[]
    >`
      SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.status, ct.lead_score,
             co.name AS company_name, co.domain, co.icp_score,
             p.slug AS product_slug, p.name AS product_name
      FROM contacts ct
      INNER JOIN companies co ON co.id = ct.company_id
      LEFT JOIN products p ON p.id = ct.product_id
      WHERE NOT ct.do_not_contact
        AND (${productSlug ?? null}::text IS NULL OR p.slug = ${productSlug ?? null})
      ORDER BY ct.updated_at DESC
    `;
    return rows.map((r) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      status: r.status,
      leadScore: r.lead_score,
      companyName: r.company_name,
      domain: r.domain,
      icpScore: r.icp_score,
      productSlug: r.product_slug,
      productName: r.product_name,
    }));
  } finally {
    await db.sql.end();
  }
}

export async function getProducts(): Promise<ProductRow[]> {
  const db = getDb();
  try {
    const rows = await db.sql<
      {
        id: string;
        slug: string;
        name: string;
        description: string | null;
        layman_pitch: string | null;
        status: string;
        repo: string | null;
        price_cents: number | null;
        billing: string | null;
        landing_path: string | null;
        metadata: unknown;
        contact_count: string;
      }[]
    >`
      SELECT p.id, p.slug, p.name, p.description, p.layman_pitch, p.status::text AS status,
             p.repo, p.price_cents, p.billing, p.landing_path, p.metadata,
             COUNT(ct.id)::text AS contact_count
      FROM products p
      LEFT JOIN contacts ct ON ct.product_id = p.id
      GROUP BY p.id
      ORDER BY p.status = 'active' DESC, p.name ASC
    `;
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      laymanPitch: r.layman_pitch,
      status: r.status,
      repo: r.repo,
      priceCents: r.price_cents,
      billing: r.billing,
      landingPath: r.landing_path,
      contactCount: Number(r.contact_count),
      cacAssumptions: parseProductCacAssumptions(
        (r.metadata as Record<string, unknown> | null)?.cac,
      ),
      intelligence: parseIntelligence((r.metadata as Record<string, unknown> | null)?.intelligence),
    }));
  } finally {
    await db.sql.end();
  }
}

function parseIntelligence(value: unknown): RepoIntelligenceRecord | null {
  if (!value || typeof value !== "object") return null;
  const v = value as RepoIntelligenceRecord;
  if (!v.auditedAt || !v.scores) return null;
  return v;
}

export async function getRepoIntelligenceProducts(): Promise<ProductRow[]> {
  const products = await getProducts();
  return products
    .filter((p) => p.intelligence)
    .sort(
      (a, b) =>
        (b.intelligence?.scores.readinessScore ?? 0) -
        (a.intelligence?.scores.readinessScore ?? 0),
    );
}

export async function getGlobalCacDefaults(): Promise<GlobalCacDefaults> {
  const db = getDb();
  try {
    return await loadGlobalCacDefaults(db);
  } finally {
    await db.sql.end();
  }
}

export async function getProductBySlug(slug: string): Promise<ProductRow | null> {
  const products = await getProducts();
  return products.find((p) => p.slug === slug) ?? null;
}

export async function getActiveProducts(): Promise<ProductRow[]> {
  const products = await getProducts();
  return products.filter((p) => p.status === "active" || p.status === "beta");
}

export async function getPendingApprovals(): Promise<ApprovalItem[]> {
  const db = getDb();
  try {
    const rows = await db.sql<
      {
        id: string;
        action: string;
        agent_id: string;
        reason: string | null;
        payload: Record<string, unknown>;
        created_at: Date;
        contact_email: string | null;
        first_name: string | null;
        last_name: string | null;
        company_name: string | null;
      }[]
    >`
      SELECT a.id, a.action::text AS action, a.agent_id, a.reason, a.payload, a.created_at,
             ct.email AS contact_email, ct.first_name, ct.last_name, co.name AS company_name
      FROM approvals a
      LEFT JOIN contacts ct ON ct.id = a.contact_id
      LEFT JOIN companies co ON co.id = a.company_id
      WHERE a.status = 'pending'
      ORDER BY a.created_at ASC
    `;
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      agentId: r.agent_id,
      reason: r.reason,
      payload: r.payload ?? {},
      createdAt: r.created_at,
      contactEmail: r.contact_email,
      contactName: [r.first_name, r.last_name].filter(Boolean).join(" ") || null,
      companyName: r.company_name,
    }));
  } finally {
    await db.sql.end();
  }
}

export async function getMetrics(): Promise<DashboardMetrics> {
  const db = getDb();
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [activity] = await db.sql<
      { emails_sent: string; replies: string; meetings: string }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE type = 'email_sent')::text AS emails_sent,
        COUNT(*) FILTER (WHERE type = 'email_replied')::text AS replies,
        COUNT(*) FILTER (WHERE type = 'meeting_booked')::text AS meetings
      FROM activities WHERE occurred_at::date = ${today}::date
    `;
    const [counts] = await db.sql<{ pending: string; contacts: string }[]>`
      SELECT
        (SELECT COUNT(*)::text FROM approvals WHERE status = 'pending') AS pending,
        (SELECT COUNT(*)::text FROM contacts WHERE NOT do_not_contact) AS contacts
    `;
    return {
      emailsSent: Number(activity?.emails_sent ?? 0),
      replies: Number(activity?.replies ?? 0),
      meetingsBooked: Number(activity?.meetings ?? 0),
      pendingApprovals: Number(counts?.pending ?? 0),
      totalContacts: Number(counts?.contacts ?? 0),
    };
  } finally {
    await db.sql.end();
  }
}

export async function getWeeklyMetrics(): Promise<WeeklyMetrics> {
  const db = getDb();
  try {
    const [activity] = await db.sql<
      { emails_sent: string; replies: string; meetings: string }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE type = 'email_sent')::text AS emails_sent,
        COUNT(*) FILTER (WHERE type = 'email_replied')::text AS replies,
        COUNT(*) FILTER (WHERE type = 'meeting_booked')::text AS meetings
      FROM activities
      WHERE occurred_at >= date_trunc('week', now())
    `;
    return {
      emailsSent: Number(activity?.emails_sent ?? 0),
      replies: Number(activity?.replies ?? 0),
      meetingsBooked: Number(activity?.meetings ?? 0),
    };
  } finally {
    await db.sql.end();
  }
}

export async function getActivities(limit = 50): Promise<ActivityRow[]> {
  const db = getDb();
  try {
    const rows = await db.sql<
      {
        id: string;
        type: string;
        agent_id: string | null;
        subject: string | null;
        body: string | null;
        contact_email: string | null;
        company_name: string | null;
        occurred_at: Date;
      }[]
    >`
      SELECT a.id, a.type::text AS type, a.agent_id, a.subject, a.body,
             ct.email AS contact_email, co.name AS company_name, a.occurred_at
      FROM activities a
      LEFT JOIN contacts ct ON ct.id = a.contact_id
      LEFT JOIN companies co ON co.id = a.company_id
      ORDER BY a.occurred_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      agentId: r.agent_id,
      subject: r.subject,
      body: r.body,
      contactEmail: r.contact_email,
      companyName: r.company_name,
      occurredAt: r.occurred_at,
    }));
  } finally {
    await db.sql.end();
  }
}

export async function getContactById(id: string): Promise<ContactDetail | null> {
  const db = getDb();
  try {
    const [row] = await db.sql<
      {
        id: string;
        first_name: string | null;
        last_name: string | null;
        email: string;
        status: string;
        lead_score: number | null;
        lead_score_reason: string | null;
        company_name: string;
        domain: string;
        icp_score: number | null;
      }[]
    >`
      SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.status,
             ct.lead_score, ct.lead_score_reason,
             co.name AS company_name, co.domain, co.icp_score
      FROM contacts ct
      INNER JOIN companies co ON co.id = ct.company_id
      WHERE ct.id = ${id}
    `;
    if (!row) return null;

    const contactActivities = await db.sql<
      {
        id: string;
        type: string;
        agent_id: string | null;
        subject: string | null;
        body: string | null;
        occurred_at: Date;
      }[]
    >`
      SELECT id, type::text AS type, agent_id, subject, body, occurred_at
      FROM activities WHERE contact_id = ${id}
      ORDER BY occurred_at DESC LIMIT 30
    `;

    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      status: row.status,
      leadScore: row.lead_score,
      leadScoreReason: row.lead_score_reason,
      companyName: row.company_name,
      domain: row.domain,
      icpScore: row.icp_score,
      activities: contactActivities.map((a) => ({
        id: a.id,
        type: a.type,
        agentId: a.agent_id,
        subject: a.subject,
        body: a.body,
        contactEmail: row.email,
        companyName: row.company_name,
        occurredAt: a.occurred_at,
      })),
    };
  } finally {
    await db.sql.end();
  }
}

export async function getSystemStatus(): Promise<{ outreachPaused: boolean }> {
  const db = getDb();
  try {
    const [row] = await db.sql<{ value: boolean }[]>`
      SELECT value FROM agent_memory
      WHERE namespace = 'system' AND key = 'outreach_paused'
    `;
    return { outreachPaused: row?.value === true };
  } finally {
    await db.sql.end();
  }
}

export function groupContactsByColumn(
  contacts: PipelineContact[],
): Map<string, PipelineContact[]> {
  const grouped = new Map<string, PipelineContact[]>();
  for (const col of PIPELINE_COLUMNS) {
    grouped.set(col.key, []);
  }
  for (const contact of contacts) {
    const column = PIPELINE_COLUMNS.find((c) => c.statuses.includes(contact.status));
    const key = column?.key ?? "lead";
    grouped.get(key)?.push(contact);
  }
  return grouped;
}
