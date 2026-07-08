#!/usr/bin/env tsx
/**
 * One-shot go-live for makola.org:
 *   Resend domain + Vercel DNS + webhook + Render env + smoke check
 *
 * Usage:
 *   RESEND_API_KEY=re_... RENDER_API_KEY=rnd_... npx tsx scripts/setup-makola.ts
 *
 * Optional:
 *   RENDER_SERVICE_ID=srv_...  (auto-detected from growth-agent-yrll if omitted)
 *   SKIP_RENDER=true           (only Resend + Vercel DNS)
 *   SKIP_DNS=true              (only Resend + Render; DNS already set)
 */

import { config } from "dotenv";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env") });

const DOMAIN = "makola.org";
const FROM_EMAIL = `Alex <outreach@${DOMAIN}>`;
const REPLY_TO = `alex@${DOMAIN}`;
const WEBHOOK_URL = "https://growth-agent-yrll.onrender.com/webhooks/resend";
const RENDER_API = "https://api.render.com/v1";

interface ResendDomainRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  priority?: number;
  status?: string;
}

interface ResendDomain {
  id: string;
  name: string;
  status: string;
  records: ResendDomainRecord[];
}

async function resend<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY required");

  const res = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend ${path}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

function vercelDnsAdd(name: string, type: string, value: string, priority?: number): void {
  const host = name === DOMAIN || name === "@" ? "@" : name.replace(`.${DOMAIN}`, "");
  const args =
    type === "MX" && priority != null
      ? `vercel dns add ${DOMAIN} ${host} MX ${value} ${priority}`
      : `vercel dns add ${DOMAIN} ${host} ${type} ${value}`;

  try {
    execSync(args, { stdio: "pipe", encoding: "utf8" });
    console.log(`  ✅ DNS ${type} ${host}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already exists") || msg.includes("duplicate")) {
      console.log(`  ⏭️  DNS ${type} ${host} (exists)`);
    } else {
      console.log(`  ⚠️  DNS ${type} ${host}: ${msg.split("\n")[0]}`);
    }
  }
}

async function ensureResendDomain(): Promise<ResendDomain> {
  const listed = await resend<{ data: ResendDomain[] }>("/domains");
  const existing = listed.data?.find((d) => d.name === DOMAIN);
  if (existing) {
    console.log(`\n📧 Resend domain exists (${existing.status})`);
    const full = await resend<ResendDomain>(`/domains/${existing.id}`);
    return full;
  }

  console.log("\n📧 Creating Resend domain…");
  const created = await resend<ResendDomain>("/domains", {
    method: "POST",
    body: JSON.stringify({
      name: DOMAIN,
      region: "us-east-1",
      capabilities: { sending: "enabled", receiving: "enabled" },
    }),
  });
  return created;
}

function syncVercelDns(records: ResendDomainRecord[]): void {
  if (process.env.SKIP_DNS === "true") {
    console.log("\n⏭️  SKIP_DNS=true — not touching Vercel DNS");
    return;
  }

  console.log("\n🌐 Adding DNS records to Vercel…");
  for (const r of records) {
    const name = r.name === DOMAIN ? "@" : r.name;
    vercelDnsAdd(name, r.type, r.value, r.priority);
  }
}

async function verifyResendDomain(id: string): Promise<void> {
  console.log("\n🔍 Verifying domain in Resend…");
  await resend(`/domains/${id}/verify`, { method: "POST", body: "{}" });
  const domain = await resend<ResendDomain>(`/domains/${id}`);
  console.log(`   Status: ${domain.status}`);
  for (const r of domain.records ?? []) {
    console.log(`   ${r.type} ${r.name}: ${r.status ?? "pending"}`);
  }
}

async function ensureWebhook(): Promise<string | undefined> {
  const list = await resend<{ data: { id: string; endpoint: string; signing_secret?: string }[] }>(
    "/webhooks",
  );
  const hit = list.data?.find((w) => w.endpoint === WEBHOOK_URL);
  if (hit) {
    console.log(`\n🔗 Webhook exists: ${WEBHOOK_URL}`);
    return hit.signing_secret;
  }

  console.log("\n🔗 Creating webhook…");
  const created = await resend<{ id: string; signing_secret?: string }>("/webhooks", {
    method: "POST",
    body: JSON.stringify({
      endpoint: WEBHOOK_URL,
      events: ["email.received"],
    }),
  });
  console.log(`   ✅ ${WEBHOOK_URL}`);
  return created.signing_secret;
}

async function findRenderServiceId(): Promise<string | undefined> {
  if (process.env.RENDER_SERVICE_ID) return process.env.RENDER_SERVICE_ID;

  const key = process.env.RENDER_API_KEY;
  if (!key) return undefined;

  const res = await fetch(`${RENDER_API}/services?limit=50`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return undefined;

  const services = (await res.json()) as { id: string; name: string; serviceDetails?: { url?: string } }[];
  const match =
    services.find((s) => s.serviceDetails?.url?.includes("growth-agent-yrll")) ??
    services.find((s) => s.name.includes("growth-agent"));
  return match?.id;
}

async function updateRenderEnv(webhookSecret?: string): Promise<void> {
  if (process.env.SKIP_RENDER === "true") {
    console.log("\n⏭️  SKIP_RENDER=true — skipping Render env");
    return;
  }

  const key = process.env.RENDER_API_KEY;
  if (!key) {
    console.log("\n⚠️  RENDER_API_KEY not set — add Render env manually (see below)");
    return;
  }

  const serviceId = await findRenderServiceId();
  if (!serviceId) {
    console.log("\n⚠️  Render service not found — set RENDER_SERVICE_ID=srv_...");
    return;
  }

  const envVars: { key: string; value: string }[] = [
    { key: "RESEND_API_KEY", value: process.env.RESEND_API_KEY! },
    { key: "RESEND_FROM_EMAIL", value: FROM_EMAIL },
    { key: "RESEND_REPLY_TO", value: REPLY_TO },
    { key: "MOCK_INTEGRATIONS", value: "false" },
  ];
  if (webhookSecret) {
    envVars.push({ key: "RESEND_WEBHOOK_SECRET", value: webhookSecret });
  }

  console.log(`\n🚀 Updating Render service ${serviceId}…`);
  for (const { key: k, value } of envVars) {
    const res = await fetch(`${RENDER_API}/services/${serviceId}/env-vars`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ envVar: { key: k, value } }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.log(`   ⚠️  ${k}: ${body}`);
    } else {
      console.log(`   ✅ ${k}`);
    }
  }

  await fetch(`${RENDER_API}/services/${serviceId}/deploys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  console.log("   ✅ Deploy triggered");
}

async function checkHealth(): Promise<void> {
  console.log("\n🏥 Health check (wait ~2 min after Render deploy)…");
  try {
    const res = await fetch(WEBHOOK_URL.replace("/webhooks/resend", "/health"));
    const json = (await res.json()) as { mock?: boolean; ok?: boolean };
    console.log(`   ${JSON.stringify(json)}`);
    if (json.mock === false) console.log("   ✅ LIVE");
    else console.log("   ⏳ Still mock:true — Render may still be deploying");
  } catch {
    console.log("   ⚠️  Could not reach Render health endpoint");
  }
}

async function main(): Promise<void> {
  console.log(`\n=== makola.org go-live setup ===\n`);

  if (!process.env.RESEND_API_KEY) {
    console.error("❌ RESEND_API_KEY required");
    console.error("   Get one: https://resend.com/api-keys");
    console.error("   Run: RESEND_API_KEY=re_... RENDER_API_KEY=rnd_... npx tsx scripts/setup-makola.ts");
    process.exit(1);
  }

  const domain = await ensureResendDomain();
  syncVercelDns(domain.records ?? []);
  await verifyResendDomain(domain.id);
  const webhookSecret = await ensureWebhook();
  await updateRenderEnv(webhookSecret);
  await checkHealth();

  console.log(`
=== Done ===

Next:
  1. Wait for Resend domain status: verified (refresh Resend dashboard)
  2. curl ${WEBHOOK_URL.replace("/webhooks/resend", "/health")}  → mock:false
  3. Resend → send test email from outreach@${DOMAIN} to yourself
  4. Reply → confirm webhook 200 in Resend

Manual Render env (if script skipped Render):
  RESEND_FROM_EMAIL=${FROM_EMAIL}
  RESEND_REPLY_TO=${REPLY_TO}
  MOCK_INTEGRATIONS=false
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
