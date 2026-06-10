"use client";

export function RoleBadge({
  role,
}: {
  role: "sender" | "recipient" | "both";
}) {
  const label = role === "both" ? "Sender + Recipient" : role === "recipient" ? "Recipient" : "Sender";
  const classes =
    role === "both"
      ? "border-[#7c3aed]/25 bg-[#7c3aed]/10 text-[#a78bfa]"
      : role === "sender"
        ? "border-[#2e3648] bg-[#161a25] text-[#b4b9c5]"
        : "border-[#222838] bg-[#13161f] text-[#64748b]";

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-[0.06em] ${classes}`}>
      {label}
    </span>
  );
}
