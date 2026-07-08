import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SignupForm } from "@/components/signup-form";
import { DemoCallCta } from "@/components/demo-call-cta";
import { BRAND } from "@/lib/brand";
import { getProductBySlug } from "@/lib/db";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

const HVAC_SLUG = "hvac-receptionist-agent";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Product not found" };
  return {
    title: `${product.name} — ${BRAND.name}`,
    description: product.laymanPitch ?? product.description ?? undefined,
  };
}

function formatPrice(cents: number | null, billing: string | null): string | null {
  if (cents == null) return null;
  const dollars = (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  if (billing === "monthly") return `${dollars}/mo`;
  if (billing === "annual") return `${dollars}/yr`;
  return dollars;
}

export default async function ProductLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product || product.status === "archived") notFound();

  const price = formatPrice(product.priceCents, product.billing);
  const isHvac = slug === HVAC_SLUG;

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
        {isHvac && (
          <div className="mb-12">
            <DemoCallCta />
          </div>
        )}

        <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
          <div>
            {price && (
              <p className="text-sm font-medium uppercase tracking-widest text-accent">
                From {price}
              </p>
            )}
            <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              {isHvac ? "Never miss an after-hours HVAC call." : product.name}
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-zinc-300">
              {product.laymanPitch ??
                product.description ??
                "AI-powered solution built for your workflow."}
            </p>
            {isHvac && (
              <ul className="mt-6 space-y-2 text-sm text-zinc-400">
                <li>· Answers 24/7 — books service calls, routes emergencies</li>
                <li>· 30-day tuning included</li>
                <li>· One booked job often covers the monthly cost</li>
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-surface-border bg-surface-raised p-8">
            <h2 className="text-lg font-semibold">
              {isHvac ? "Start pilot" : "Get details"}
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              {isHvac
                ? "We'll reach out within one business day."
                : "We'll route your inquiry to the right playbook."}
            </p>
            <SignupForm productSlug={slug} />
          </div>
        </div>
      </main>
    </div>
  );
}
