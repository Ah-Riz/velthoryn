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
    <div className={`relative overflow-hidden rounded-xl border bg-muted px-3 py-2.5 sm:rounded-2xl sm:p-5 transition-colors ${accent ? "border-line-hover hover:border-primary/40" : "border-line hover:border-line-hover"} ${className ?? ""}`}>
      {accent && (
        <div className="pointer-events-none absolute inset-0 rounded-xl sm:rounded-2xl" style={{ background: "radial-gradient(ellipse at top right, rgba(124,58,237,0.10), transparent 70%)" }} />
      )}
      <div className="font-mono text-[9px] sm:text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      {loading ? (
        <div className="mt-1.5 sm:mt-2 h-6 sm:h-8 w-14 sm:w-16 animate-pulse rounded-lg bg-foreground/10" />
      ) : (
        <div className={`mt-1 sm:mt-2 text-[20px] sm:text-[28px] font-semibold leading-none tracking-tight ${accent ? "text-accent-light" : "text-foreground"}`}>{value}</div>
      )}
      {sub && <div className="mt-1 sm:mt-1.5 font-mono text-[10px] sm:text-[11px] text-muted-foreground truncate">{sub}</div>}
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
    <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-5">
      <div className="h-3 w-24 rounded bg-foreground/[0.06]" />
      <div className="mt-3 h-8 w-28 rounded bg-foreground/[0.08]" />
    </div>
  );
}
