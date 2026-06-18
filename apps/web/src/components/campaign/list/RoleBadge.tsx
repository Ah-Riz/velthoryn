"use client";

export function RoleBadge({
  role,
}: {
  role: "sender" | "recipient" | "both";
}) {
  const label = role === "both" ? "Sender + Recipient" : role === "recipient" ? "Recipient" : "Sender";
  const classes =
    role === "both"
      ? "border-primary/25 bg-primary/10 text-accent-light"
      : role === "sender"
        ? "border-line-hover bg-surface-hover text-secondary-foreground"
        : "border-line bg-muted text-muted-foreground";

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-[0.06em] ${classes}`}>
      {label}
    </span>
  );
}
