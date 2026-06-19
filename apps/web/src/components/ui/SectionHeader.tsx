"use client";

interface SectionHeaderProps {
  title: string;
  caption?: string;
  action?: React.ReactNode;
}

export function SectionHeader({ title, caption }: SectionHeaderProps) {
  return (
    <div>
      <h2 className="text-[16px] font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">{caption}</p>
    </div>
  );
}
