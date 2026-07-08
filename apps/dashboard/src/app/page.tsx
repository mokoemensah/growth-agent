import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "@/components/signup-form";
import { DemoCallCta } from "@/components/demo-call-cta";
import { BRAND } from "@/lib/brand";
import { getActiveProducts } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description:
    "Autonomous revenue system for local service businesses. Your AI sales employee — finds leads, sends outreach, books meetings.",
};

export default async function LandingPage() {
  const products = await getActiveProducts();

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-surface-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="font-semibold tracking-tight">{BRAND.name}</span>
          <div className="flex items-center gap-6">
            <Link href="/hvac" className="text-sm text-zinc-400 hover:text-accent">
              HVAC →
            </Link>
            <Link href="/dashboard" className="text-sm text-zinc-400 hover:text-accent">
              Dashboard →
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-16">
        <div className="text-center">
          <p className="text-sm font-medium uppercase tracking-widest text-accent">
            {BRAND.platform}
          </p>
          <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
            {BRAND.tagline}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
            Makola finds local businesses, researches them, sends personalized outreach, triages
            replies, and books meetings — while you focus on closing.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link
              href="/hvac"
              className="rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-black transition hover:bg-accent/90"
            >
              See HVAC demo →
            </Link>
            <Link
              href="/dashboard"
              className="rounded-lg border border-surface-border px-6 py-3 text-sm font-medium text-zinc-300 transition hover:border-accent/40"
            >
              Open dashboard
            </Link>
          </div>
        </div>

        <section className="mt-20">
          <DemoCallCta />
        </section>

        <section className="mt-20">
          <h2 className="text-sm font-medium uppercase tracking-widest text-zinc-500">
            Active offers
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {products.map((p) => (
              <Link
                key={p.id}
                href={p.landingPath ?? `/p/${p.slug}`}
                className="rounded-xl border border-surface-border bg-surface-raised p-6 transition hover:border-accent/40"
              >
                <p className="font-medium">{p.name}</p>
                {p.priceCents != null && (
                  <p className="mt-1 text-sm text-accent">
                    ${(p.priceCents / 100).toFixed(0)}/mo
                  </p>
                )}
                <p className="mt-3 text-sm leading-relaxed text-zinc-400 line-clamp-3">
                  {p.laymanPitch ?? p.description ?? "Learn more →"}
                </p>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-20 grid gap-12 rounded-xl border border-surface-border bg-surface-raised p-8 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="text-lg font-semibold">Operators & founders</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Leave your email — we&apos;ll route you to the right product playbook.
            </p>
          </div>
          <SignupForm />
        </section>

        <section className="mt-24 border-t border-surface-border pt-16">
          <h2 className="text-center text-sm font-medium uppercase tracking-widest text-zinc-500">
            The daily loop
          </h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-4">
            {[
              { step: "1", title: "Discover", desc: "Find & research local businesses" },
              { step: "2", title: "Outreach", desc: "Personalized email with live demo" },
              { step: "3", title: "Triage", desc: "AI classifies every reply" },
              { step: "4", title: "Learn", desc: "Winning copy compounds weekly" },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
                  {item.step}
                </div>
                <h3 className="mt-4 font-medium">{item.title}</h3>
                <p className="mt-2 text-sm text-zinc-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-surface-border py-8 text-center text-xs text-zinc-600">
        {BRAND.name} · {BRAND.domain}
      </footer>
    </div>
  );
}
