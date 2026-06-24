"use client";

import { VestingTypeSelector } from "@/components/campaign/create/VestingTypeSelector";

const FLOW_STEPS = [
  {
    num: "01",
    label: "Configure Vesting",
    desc: "Pick a schedule type, set dates, and upload recipients.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    num: "02",
    label: "Fund Vault",
    desc: "Deposit tokens into the on-chain vault to activate the stream.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
    ),
  },
  {
    num: "03",
    label: "Recipients Claim",
    desc: "Each wallet connects and claims exactly what's vested.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
] as const;

export default function CreateStreamPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-12">
      {/* Page header */}
      <div>
        <div className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-primary/70">
          Stream Setup
        </div>
        <h1 className="text-[28px] font-semibold tracking-tight text-foreground">
          Create Vesting Stream
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-7 text-muted-foreground">
          Choose a vesting schedule type. Each type determines how and when tokens unlock for recipients.
        </p>
      </div>

      <VestingTypeSelector />

      {/* 3-step visual creation flow */}
      <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-5">
        <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Creation Flow
        </p>
        <div className="flex items-stretch gap-2 sm:gap-3">
          {FLOW_STEPS.map((step, i) => (
            <>
              <div
                key={step.num}
                className="flex flex-1 flex-col gap-2.5 rounded-xl border border-foreground/[0.06] bg-foreground/[0.03] p-3.5 sm:p-4"
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/[0.08] text-accent-light">
                    {step.icon}
                  </div>
                  <span className="font-mono text-[10px] font-medium text-primary/50">
                    {step.num}
                  </span>
                </div>
                <div>
                  <p className="text-[13px] font-semibold leading-snug text-foreground">
                    {step.label}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                    {step.desc}
                  </p>
                </div>
              </div>

              {i < FLOW_STEPS.length - 1 && (
                <div key={`arrow-${i}`} className="flex shrink-0 items-center">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-muted-foreground/40"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
              )}
            </>
          ))}
        </div>
      </div>
    </div>
  );
}
