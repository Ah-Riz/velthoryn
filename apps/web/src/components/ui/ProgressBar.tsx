"use client";

interface ProgressBarProps {
  percentage: number;
  className?: string;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
  colorClass?: string;
  trackClassName?: string;
}

const sizeClasses = {
  sm: "h-1.5",
  md: "h-2.5",
  lg: "h-3",
};

export function ProgressBar({
  percentage,
  className,
  showLabel = false,
  size = "md",
  colorClass = "bg-violet-500",
  trackClassName = "bg-white/[0.06]",
}: ProgressBarProps) {
  const clampedPercent = Math.min(100, percentage);
  const heightClass = sizeClasses[size];

  const fill = (
    <div
      className={`h-full rounded-full ${showLabel ? "transition-all" : ""} ${colorClass}`}
      style={{ width: `${clampedPercent}%` }}
    />
  );

  if (showLabel) {
    return (
      <div className={className}>
        <div className="flex items-center justify-between text-[11px] text-[#555d73]">
          <span>Progress</span>
          <span>{percentage.toFixed(1)}%</span>
        </div>
        <div className={`mt-1.5 ${heightClass} overflow-hidden rounded-full ${trackClassName}`}>
          {fill}
        </div>
      </div>
    );
  }

  return (
    <div className={`${heightClass} overflow-hidden rounded-full ${trackClassName} ${className ?? ""}`}>
      {fill}
    </div>
  );
}
