import { DEFAULT_DEMO_LINE, DEMO_LINES, formatPhoneDisplay } from "@/lib/demo-lines";

interface DemoCallCtaProps {
  variant?: "hero" | "compact";
  highlightLabel?: string;
}

export function DemoCallCta({ variant = "hero", highlightLabel }: DemoCallCtaProps) {
  const primary = highlightLabel
    ? (DEMO_LINES.find((l) => l.label === highlightLabel) ?? DEFAULT_DEMO_LINE)
    : DEFAULT_DEMO_LINE;
  const display = formatPhoneDisplay(primary.number);

  if (variant === "compact") {
    return (
      <a
        href={`tel:${primary.number}`}
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-black transition hover:bg-accent/90"
      >
        Call demo · {display}
      </a>
    );
  }

  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/5 p-8 text-center">
      <p className="text-sm font-medium uppercase tracking-widest text-accent">
        Live demo · {primary.label}
      </p>
      <a
        href={`tel:${primary.number}`}
        className="mt-4 block text-4xl font-bold tracking-tight text-zinc-50 hover:text-accent sm:text-5xl"
      >
        {display}
      </a>
      <p className="mx-auto mt-4 max-w-md text-sm text-zinc-400">
        Call now. Pretend your AC stopped working at 9pm on a Saturday — that&apos;s what your
        customers get.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {DEMO_LINES.map((line) => (
          <a
            key={line.number}
            href={`tel:${line.number}`}
            className="rounded-full border border-surface-border px-3 py-1 text-xs text-zinc-400 transition hover:border-accent/40 hover:text-zinc-200"
          >
            {line.label} · {formatPhoneDisplay(line.number)}
          </a>
        ))}
      </div>
    </div>
  );
}
