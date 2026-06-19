"use client";

import Link from "next/link";

export function PageHeader({
  title,
  description,
  backLabel = "Back to types",
}: {
  title: string;
  description: string;
  backLabel?: string;
}) {
  return (
    <div>
      <Link href="/campaign/create" className="mb-3 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition hover:text-foreground">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5" />
          <path d="M12 19l-7-7 7-7" />
        </svg>
        {backLabel}
      </Link>
      <h1 className="text-[24px] font-semibold tracking-tight text-foreground">{title}</h1>
      <p className="mt-1 text-[14px] text-muted-foreground">{description}</p>
    </div>
  );
}
