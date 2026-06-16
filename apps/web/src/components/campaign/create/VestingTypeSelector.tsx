"use client";

import { useState } from "react";
import Link from "next/link";

type Slug = "cliff" | "linear" | "milestone";

const VESTING_TYPES: Array<{
  slug: Slug;
  label: string;
  desc: string;
  bestFor: string;
  learn: string;
  iconColor: string;
  borderHover: string;
  shadow: string;
  gradient: string;
  cta: string;
  icon: React.ReactNode;
}> = [
  {
    slug: "cliff",
    label: "Cliff Vesting",
    desc: "All tokens unlock at a single date. Nothing before, everything after.",
    bestFor: "Token launches, investor lockups, and team grants with a fixed unlock date.",
    learn: "Like a safe that opens on a specific day. Until that date, recipients can't access anything. On the cliff date, 100% of their tokens become available at once. Simple, predictable, and easy to communicate.",
    iconColor: "text-amber-400",
    borderHover: "hover:border-amber-500/40",
    shadow: "hover:shadow-[0_0_28px_-4px_rgba(245,158,11,0.18)]",
    gradient: "from-amber-500/[0.12] to-transparent",
    cta: "bg-amber-600 hover:bg-amber-500",
    icon: (
      <svg width="40" height="40" viewBox="0 0 48 48" fill="none" className="text-amber-400">
        <path d="M8 36 H20 V12 H40" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="20" cy="12" r="3.5" fill="currentColor" opacity="0.5" />
        <circle cx="20" cy="36" r="3.5" fill="currentColor" opacity="0.25" />
        <circle cx="40" cy="12" r="3.5" fill="currentColor" opacity="0.5" />
      </svg>
    ),
  },
  {
    slug: "linear",
    label: "Linear Vesting",
    desc: "Tokens release gradually from cliff date to end date. Smooth, proportional unlock.",
    bestFor: "Employee equity, advisor allocations, and contributor rewards distributed over time.",
    learn: "Like water dripping steadily from a tap. After the cliff date, tokens unlock continuously — each second more becomes available, proportional to time elapsed. Great for long-term alignment without sudden large unlocks.",
    iconColor: "text-violet-400",
    borderHover: "hover:border-violet-500/40",
    shadow: "hover:shadow-[0_0_28px_-4px_rgba(139,92,246,0.18)]",
    gradient: "from-violet-500/[0.12] to-transparent",
    cta: "bg-violet-600 hover:bg-violet-500",
    icon: (
      <svg width="40" height="40" viewBox="0 0 48 48" fill="none" className="text-violet-400">
        <path d="M8 38 L16 38 L36 10 L42 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="16" cy="38" r="3.5" fill="currentColor" opacity="0.25" />
        <circle cx="36" cy="10" r="3.5" fill="currentColor" opacity="0.5" />
      </svg>
    ),
  },
  {
    slug: "milestone",
    label: "Milestone Vesting",
    desc: "Full release after a time-gated milestone. Tracked by on-chain bitmap index.",
    bestFor: "Grant programs, partnerships, and KPI-based releases where you control each tranche.",
    learn: "Like unlocking chapters of a book. You define milestones, and each one you trigger manually releases a portion of tokens. Recipients know exactly what they need to achieve — and when you approve it, they can claim immediately.",
    iconColor: "text-blue-400",
    borderHover: "hover:border-blue-500/40",
    shadow: "hover:shadow-[0_0_28px_-4px_rgba(59,130,246,0.18)]",
    gradient: "from-blue-500/[0.12] to-transparent",
    cta: "bg-blue-600 hover:bg-blue-500",
    icon: (
      <svg width="40" height="40" viewBox="0 0 48 48" fill="none" className="text-blue-400">
        <path d="M8 38 H18 V24 H28 V12 H40" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="18" cy="24" r="3.5" fill="currentColor" opacity="0.4" />
        <circle cx="28" cy="12" r="3.5" fill="currentColor" opacity="0.5" />
      </svg>
    ),
  },
];

export const VESTING_TYPES_EXPORT = VESTING_TYPES;

export function VestingTypeSelector() {
  const [learnOpen, setLearnOpen] = useState<Slug | null>(null);
  const openType = learnOpen ? VESTING_TYPES.find((t) => t.slug === learnOpen) : null;

  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        {VESTING_TYPES.map((type) => (
          <div key={type.slug} className="group relative flex flex-col">
            <Link
              href={`/campaign/create/${type.slug}`}
              className={`relative flex h-full flex-col rounded-2xl border border-foreground/[0.08] bg-card p-6 transition-all duration-300 ${type.borderHover} ${type.shadow} hover:-translate-y-0.5 hover:bg-foreground/[0.02]`}
            >
              {/* Hover gradient */}
              <div
                className={`absolute inset-0 rounded-2xl bg-gradient-to-b ${type.gradient} opacity-0 transition-opacity duration-300 group-hover:opacity-100`}
              />

              {/* Top section — icon, title, best for */}
              <div className="relative flex flex-1 flex-col gap-4">
                {/* Icon + Info button row */}
                <div className="flex items-start justify-between">
                  <div className="flex h-[60px] w-[60px] items-center justify-center rounded-xl border border-foreground/[0.06] bg-foreground/[0.03]">
                    {type.icon}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setLearnOpen(type.slug);
                    }}
                    className="rounded-full border border-foreground/[0.08] bg-foreground/[0.03] p-1.5 text-muted-foreground transition hover:border-foreground/20 hover:bg-foreground/[0.06] hover:text-foreground"
                    aria-label={`Learn about ${type.label}`}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4M12 8h.01" />
                    </svg>
                  </button>
                </div>

                {/* Title + description */}
                <div className="min-h-[3.75rem]">
                  <h2 className="text-[16px] font-semibold text-foreground">{type.label}</h2>
                  <p className="mt-1.5 text-[13px] leading-6 text-muted-foreground">{type.desc}</p>
                </div>

                {/* Best For */}
                <div className="min-h-[5rem] rounded-xl border border-foreground/[0.06] bg-foreground/[0.025] px-3 py-2.5">
                  <p className="font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Best For
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-secondary-foreground">
                    {type.bestFor}
                  </p>
                </div>
              </div>

              {/* CTA — pinned to bottom */}
              <div
                className={`relative mt-5 flex items-center gap-1.5 text-[12px] font-medium ${type.iconColor} transition-all duration-200 group-hover:gap-2`}
              >
                Configure
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-transform duration-200 group-hover:translate-x-0.5"
                >
                  <path d="M5 12h14" />
                  <path d="M12 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          </div>
        ))}
      </div>

      {/* Learn More Modal */}
      {openType && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setLearnOpen(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-foreground/[0.1] bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.03] p-2">
                  {openType.icon}
                </div>
                <div>
                  <h3 className="text-[17px] font-semibold text-foreground">{openType.label}</h3>
                  <p className="text-[12px] text-muted-foreground">How it works</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLearnOpen(null)}
                className="rounded-lg border border-foreground/[0.08] p-1.5 text-muted-foreground transition hover:border-foreground/20 hover:text-foreground"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Explanation */}
            <p className="text-[14px] leading-6 text-secondary-foreground">{openType.learn}</p>

            {/* Best For */}
            <div className="mt-4 rounded-xl border border-foreground/[0.06] bg-foreground/[0.025] px-4 py-3">
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Best For
              </p>
              <p className="mt-1.5 text-[13px] leading-5 text-secondary-foreground">{openType.bestFor}</p>
            </div>

            {/* Actions */}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setLearnOpen(null)}
                className="flex-1 rounded-xl border border-foreground/[0.08] py-2.5 text-[13px] text-muted-foreground transition hover:border-foreground/20 hover:text-foreground"
              >
                Close
              </button>
              <Link
                href={`/campaign/create/${openType.slug}`}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-center text-[13px] font-medium text-white transition ${openType.cta}`}
              >
                Configure
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
