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
    <div className="rounded-2xl border border-dashed border-[#222838] bg-[#13161f]/60 px-8 py-16 text-center">
      <h2 className="text-[16px] font-semibold text-[#e5e7eb]">{title}</h2>
      <p className="mt-2 font-mono text-[12px] text-[#64748b]">{body}</p>
      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          className="mt-5 inline-flex rounded-xl border border-[#7c3aed]/30 bg-[#7c3aed]/15 px-4 py-2.5 font-mono text-[12px] font-medium text-[#a78bfa] transition hover:border-[#7c3aed]/50 hover:bg-[#7c3aed]/25"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
