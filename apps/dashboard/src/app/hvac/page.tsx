import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { DemoCallCta } from "@/components/demo-call-cta";

export const metadata: Metadata = {
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description:
    "Autonomous revenue system for local service businesses. Find leads, send outreach, triage replies, book meetings — while you sleep.",
};

export default function HvacLandingPage() {
  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-surface-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-semibold tracking-tight">
            {BRAND.name}
          </Link>
          <Link href="/dashboard" className="text-sm text-zinc-400 hover:text-accent">
            Dashboard →
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-16">
        <div className="text-center">
          <p className="text-sm font-medium uppercase tracking-widest text-accent">
            For HVAC shops · $299/mo pilot
          </p>
          <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
            Never miss an after-hours call again.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
            AI answers your shop line 24/7, books service calls, and routes emergencies — so you
            stop losing jobs to voicemail.
          </p>
        </div>

        <div className="mt-12">
          <DemoCallCta />
        </div>

        <section className="mt-20 grid gap-8 sm:grid-cols-3">
          {[
            {
              title: "More booked jobs",
              desc: "After-hours and overflow calls get answered and scheduled — not sent to voicemail.",
            },
            {
              title: "Fewer missed calls",
              desc: "Peak season, weekends, holidays — your line stays open without hiring night staff.",
            },
            {
              title: "Less admin",
              desc: "Owners stop playing phone tag. The AI captures intent and books the slot.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-surface-border bg-surface-raised p-6"
            >
              <h2 className="font-semibold">{item.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{item.desc}</p>
            </div>
          ))}
        </section>

        <section className="mt-20 rounded-2xl border border-surface-border bg-surface-raised p-8">
          <h2 className="text-lg font-semibold">How the pilot works</h2>
          <ol className="mt-6 space-y-4 text-sm text-zinc-400">
            <li>
              <span className="font-medium text-zinc-200">1. Hear it.</span> Call the demo line
              above — that&apos;s your shop after hours.
            </li>
            <li>
              <span className="font-medium text-zinc-200">2. Pilot.</span> $299/mo, 30-day tuning,
              calendar integration included.
            </li>
            <li>
              <span className="font-medium text-zinc-200">3. Go live.</span> One booked emergency
              call often covers the month.
            </li>
          </ol>
          <div className="mt-8">
            <DemoCallCta variant="compact" />
          </div>
        </section>
      </main>

      <footer className="border-t border-surface-border py-8 text-center text-xs text-zinc-600">
        {BRAND.name} · {BRAND.domain}
      </footer>
    </div>
  );
}
