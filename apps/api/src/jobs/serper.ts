/**
 * Serper.dev lead source — Google Places search for local service businesses.
 *
 * Flow: search "hvac company <city>" → get name/website/phone → fetch the
 * website and extract a contact email (info@, contact page, mailto links).
 *
 * Cheaper than Apollo but emails are company inboxes, not named contacts,
 * so we default the contact title to "Owner" (accurate for most 3–100
 * employee shops).
 */

import type { IcpFilter } from "../../../../packages/schemas/index.js";
import type { Prospect } from "./integrations.js";

const SERPER_PLACES_URL = "https://google.serper.dev/places";
const FETCH_TIMEOUT_MS = 8_000;

/** Rotated daily so repeated runs cover new metros */
const TARGET_CITIES = [
  "Phoenix AZ",
  "Dallas TX",
  "Houston TX",
  "Atlanta GA",
  "Tampa FL",
  "Charlotte NC",
  "Las Vegas NV",
  "San Antonio TX",
  "Orlando FL",
  "Nashville TN",
  "Oklahoma City OK",
  "Kansas City MO",
  "Columbus OH",
  "Indianapolis IN",
  "Jacksonville FL",
];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SKIP_EMAIL_PATTERNS = [
  "example.com",
  "sentry",
  "wixpress",
  "godaddy",
  ".png",
  ".jpg",
  ".gif",
  ".webp",
];

interface SerperPlace {
  title?: string;
  address?: string;
  category?: string;
  website?: string;
  phoneNumber?: string;
  cid?: string;
}

interface SerperPlacesResponse {
  places?: SerperPlace[];
}

export function citiesForToday(count = 3): string[] {
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  const start = (dayIndex * count) % TARGET_CITIES.length;
  const picked: string[] = [];
  for (let i = 0; i < count; i++) {
    picked.push(TARGET_CITIES[(start + i) % TARGET_CITIES.length]);
  }
  return picked;
}

function domainFromWebsite(website: string): string | null {
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`);
    const host = url.hostname.replace(/^www\./, "");
    // Skip aggregators — we want the business's own site
    if (["facebook.com", "yelp.com", "angi.com", "google.com"].some((d) => host.endsWith(d))) {
      return null;
    }
    return host;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; lead-research/1.0)" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("text/html")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractEmail(html: string, domain: string): string | null {
  const matches = html.match(EMAIL_RE) ?? [];
  const usable = matches.filter((email) => {
    const lower = email.toLowerCase();
    return !SKIP_EMAIL_PATTERNS.some((p) => lower.includes(p));
  });
  if (usable.length === 0) return null;

  // Prefer an email on the business's own domain
  const onDomain = usable.find((e) => e.toLowerCase().endsWith(`@${domain.toLowerCase()}`));
  return (onDomain ?? usable[0]).toLowerCase();
}

export async function findContactEmail(domain: string): Promise<string | null> {
  for (const path of ["", "/contact", "/contact-us", "/about"]) {
    const html = await fetchWithTimeout(`https://${domain}${path}`);
    if (!html) continue;
    const email = extractEmail(html, domain);
    if (email) return email;
  }
  return null;
}

export async function serperSearchProspects(
  filter: IcpFilter,
  limit: number,
): Promise<Prospect[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error("Missing required env var: SERPER_API_KEY");

  const industry = filter.industries?.[0] ?? "hvac";
  const cities = citiesForToday();
  const prospects: Prospect[] = [];
  const seenDomains = new Set<string>();

  for (const city of cities) {
    if (prospects.length >= limit) break;

    const res = await fetch(SERPER_PLACES_URL, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: `${industry} company ${city}`, gl: "us" }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Serper search failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as SerperPlacesResponse;

    for (const place of data.places ?? []) {
      if (prospects.length >= limit) break;
      if (!place.website || !place.title) continue;

      const domain = domainFromWebsite(place.website);
      if (!domain || seenDomains.has(domain)) continue;
      if (filter.excludeDomains?.includes(domain)) continue;
      seenDomains.add(domain);

      const email = await findContactEmail(domain);
      if (!email) continue; // no email → can't do outreach, skip

      prospects.push({
        externalId: `serper:${place.cid ?? domain}`,
        companyName: place.title,
        domain,
        industry: place.category ?? industry,
        employeeCount: null,
        country: "US",
        contactEmail: email,
        contactFirstName: null,
        contactLastName: null,
        contactTitle: "Owner",
      });
    }
  }

  return prospects;
}
