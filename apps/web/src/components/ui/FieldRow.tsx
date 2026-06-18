"use client";

interface FieldRowProps {
  label: string;
  input: React.ReactNode;
}

export function FieldRow({ label, input }: FieldRowProps) {
  return (
    <div>
      <label className="mb-2 block text-[12px] font-medium text-muted-foreground">{label}</label>
      {input}
    </div>
  );
}
