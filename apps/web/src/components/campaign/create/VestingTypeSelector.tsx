"use client";

import Link from "next/link";

export const VESTING_TYPES = [
  {
    slug: "cliff",
    label: "Cliff Vesting",
    desc: "All tokens unlock at a single date. Nothing before, everything after.",
    gradient: "from-amber-500/20 to-amber-600/5",
    border: "hover:border-amber-500/30",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="text-amber-700 dark:text-amber-400">
        <path d="M8 36 H20 V12 H40" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <circle cx="20" cy="12" r="3" fill="currentColor" opacity="0.3" />
        <circle cx="20" cy="36" r="3" fill="currentColor" opacity="0.3" />
      </svg>
    ),
  },
  {
    slug: "linear",
    label: "Linear Vesting",
    desc: "Tokens release gradually from cliff date to end date. Smooth, proportional unlock.",
    gradient: "from-violet-500/20 to-violet-600/5",
    border: "hover:border-violet-500/30",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="text-violet-700 dark:text-violet-400">
        <path d="M8 38 L16 38 L36 10 L42 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <circle cx="16" cy="38" r="3" fill="currentColor" opacity="0.3" />
        <circle cx="36" cy="10" r="3" fill="currentColor" opacity="0.3" />
      </svg>
    ),
  },
  {
    slug: "milestone",
    label: "Milestone Vesting",
    desc: "Full release after a time-gated milestone. Tracked by on-chain bitmap index.",
    gradient: "from-blue-500/20 to-blue-600/5",
    border: "hover:border-blue-500/30",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="text-blue-400">
        <path d="M8 38 H18 V24 H28 V12 H40" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <circle cx="18" cy="24" r="3" fill="currentColor" opacity="0.3" />
        <circle cx="28" cy="12" r="3" fill="currentColor" opacity="0.3" />
      </svg>
    ),
  },
] as const;

export function VestingTypeSelector() {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {VESTING_TYPES.map((type) => (
        <Link
          key={type.slug}
          href={`/campaign/create/${type.slug}`}
          className={`group relative flex flex-col rounded-2xl border border-foreground/[0.08] bg-card p-6 transition-all duration-200 ${type.border} hover:bg-foreground/[0.02]`}
        >
          <div className={`absolute inset-0 rounded-2xl bg-gradient-to-b ${type.gradient} opacity-0 transition-opacity group-hover:opacity-100`} />

          <div className="relative">
            <div className="mb-5">{type.icon}</div>
            <h2 className="text-[17px] font-semibold text-foreground">{type.label}</h2>
            <p className="mt-2 text-[13px] leading-6 text-muted-foreground">{type.desc}</p>

            <div className="mt-5 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors group-hover:text-foreground">
              Configure
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-0.5">
                <path d="M5 12h14" />
                <path d="M12 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
