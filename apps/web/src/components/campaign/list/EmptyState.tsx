"use client";

import Link from "next/link";

type Props = {
  title: string;
  body: string;
  actionHref?: string;
  actionLabel?: string;
};

export function EmptyState({ title, body, actionHref, actionLabel }: Props) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-muted/60 px-8 py-16 text-center">
      <h2 className="text-[16px] font-semibold text-foreground">{title}</h2>
      <p className="mt-2 font-mono text-[12px] text-muted-foreground">{body}</p>
      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          className="mt-5 inline-flex rounded-xl border border-primary/30 bg-primary/15 px-4 py-2.5 font-mono text-[12px] font-medium text-accent-light transition hover:border-primary/50 hover:bg-primary/25"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
