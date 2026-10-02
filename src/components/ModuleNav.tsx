import Link from "next/link";

export function ModuleNav({ active }: { active: "debug" | "release" }) {
  return <nav aria-label="Vizu modules" className="flex gap-2 text-sm">
    {([ ["debug", "/", "Debug"], ["release", "/release", "Release"] ] as const).map(([module, href, label]) => (
      <Link key={module} href={href} aria-current={active === module ? "page" : undefined}
        className={`rounded-md border px-3 py-1.5 ${active === module ? "border-status-running bg-status-running/10 text-ink" : "border-bg-border text-ink-400 hover:text-ink"}`}>{label}</Link>
    ))}
  </nav>;
}
