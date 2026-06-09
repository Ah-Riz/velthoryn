"use client";

import { useState, useEffect } from "react";
import { getGracePeriodState } from "@/lib/vesting/display";

type GracePeriodCountdownProps = {
  cancelledAt: bigint;
  className?: string;
};

export function GracePeriodCountdown({
  cancelledAt,
  className,
}: GracePeriodCountdownProps) {
  const [nowTs, setNowTs] = useState<bigint>(() => BigInt(Math.floor(Date.now() / 1000)));

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowTs(BigInt(Math.floor(Date.now() / 1000)));
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const graceState = getGracePeriodState(cancelledAt, nowTs);

  if (graceState.status === "not_cancelled") return null;

  if (graceState.status === "grace_active") {
    const isUrgent = graceState.remaining < 86400n;
    return (
      <span
        className={`text-sm font-medium ${isUrgent ? "text-red-400" : "text-amber-400"} ${className ?? ""}`}
      >
        {graceState.countdown} remaining
      </span>
    );
  }

  return (
    <span className={`text-sm font-medium text-red-400 ${className ?? ""}`}>
      Grace period expired
    </span>
  );
}
