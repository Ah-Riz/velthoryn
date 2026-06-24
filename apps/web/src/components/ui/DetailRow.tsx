"use client";

interface DetailRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

function truncateAddress(addr: string, chars = 6): string {
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}

/** Key-value row inside the Campaign Details card. */
export function DetailRow({ label, value, mono }: DetailRowProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-[12px] text-muted-foreground">{label}</span>
      <span
        className={`text-right text-[13px] text-foreground ${mono ? "font-mono" : ""}`}
        title={value}
      >
        {mono ? truncateAddress(value) : value}
      </span>
    </div>
  );
}
