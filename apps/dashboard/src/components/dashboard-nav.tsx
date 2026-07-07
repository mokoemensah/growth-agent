import Link from "next/link";

const links = [
  { href: "/dashboard", label: "Pipeline" },
  { href: "/dashboard/products", label: "Products" },
  { href: "/dashboard/cac", label: "CAC" },
  { href: "/dashboard/repo-intelligence", label: "Repos" },
  { href: "/dashboard/activity", label: "Activity" },
];

export function DashboardNav() {
  return (
    <header className="border-b border-surface-border bg-surface-raised/80 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="text-lg font-semibold tracking-tight">
            Growth Agent
          </Link>
          <nav className="flex gap-4">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-sm text-zinc-400 hover:text-zinc-100"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <Link href="/" className="text-sm text-zinc-500 hover:text-accent">
          Landing →
        </Link>
      </div>
    </header>
  );
}
