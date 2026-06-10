"use client";

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  className?: string;
}

export function StatCard({ label, value, sub, accent, className }: StatCardProps) {
  return (
    <div className={`rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 ${className ?? ""}`}>
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#555d73]">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${accent ? "text-violet-400" : "text-white"}`}>{value}</div>
      {sub && <div className="mt-1 text-[12px] text-[#555d73]">{sub}</div>}
    </div>
  );
}

export function StatCardSkeletonGroup() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="h-3 w-24 rounded bg-white/[0.06]" />
      <div className="mt-3 h-8 w-28 rounded bg-white/[0.08]" />
    </div>
  );
}
