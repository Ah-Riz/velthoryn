"use client";

export interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  loading?: boolean;
  className?: string;
}

export function StatCard({ label, value, sub, accent, loading, className }: StatCardProps) {
  return (
    <div className={`relative overflow-hidden rounded-xl border bg-[#13161f] px-3 py-2.5 sm:rounded-2xl sm:p-5 transition-colors ${accent ? "border-[#2e3648] hover:border-[#7c3aed]/40" : "border-[#222838] hover:border-[#2e3648]"} ${className ?? ""}`}>
      {accent && (
        <div className="pointer-events-none absolute inset-0 rounded-xl sm:rounded-2xl" style={{ background: "radial-gradient(ellipse at top right, rgba(124,58,237,0.10), transparent 70%)" }} />
      )}
      <div className="font-mono text-[9px] sm:text-[10px] font-medium uppercase tracking-[0.16em] text-[#64748b]">{label}</div>
      {loading ? (
        <div className="mt-1.5 sm:mt-2 h-6 sm:h-8 w-14 sm:w-16 animate-pulse rounded-lg bg-[#1c2130]" />
      ) : (
        <div className={`mt-1 sm:mt-2 text-[20px] sm:text-[28px] font-semibold leading-none tracking-tight ${accent ? "text-[#a78bfa]" : "text-[#e5e7eb]"}`}>{value}</div>
      )}
      {sub && <div className="mt-1 sm:mt-1.5 font-mono text-[10px] sm:text-[11px] text-[#64748b] truncate">{sub}</div>}
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
