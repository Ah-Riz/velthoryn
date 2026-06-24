"use client";

import Link from "next/link";

type Props = {
  title: string;
  body: string;
  actionHref?: string;
  actionLabel?: string;
  showCreateButton?: boolean;
};

export function EmptyState({ title, body, actionHref, actionLabel, showCreateButton }: Props) {
  const href = actionHref ?? "/campaign/create";
  const label = actionLabel ?? "Create New Stream";
  const showAction = actionHref !== undefined || showCreateButton;

  return (
    <div className="rounded-2xl border border-dashed border-line bg-muted/60 px-8 py-16 text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/[0.07]">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent-light">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </div>
      <h2 className="text-[16px] font-semibold text-foreground">{title}</h2>
      <p className="mt-2 font-mono text-[12px] leading-5 text-muted-foreground max-w-xs mx-auto">{body}</p>
      {showAction && (
        <Link
          href={href}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-mono text-[12px] font-medium text-white transition hover:bg-primary/90"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {label}
        </Link>
      )}
    </div>
  );
}
