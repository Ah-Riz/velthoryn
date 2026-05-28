export function computeInstantRefundEligible(params: {
  leafCount: number;
  cancellable: boolean;
  cancelledAt: bigint | null;
  instantRefunded: boolean;
  minCliffTime: bigint | null;
  milestoneReleasedCount: number;
  nowSecs: bigint;
}): boolean {
  const {
    leafCount,
    cancellable,
    cancelledAt,
    instantRefunded,
    minCliffTime,
    milestoneReleasedCount,
    nowSecs,
  } = params;

  return (
    leafCount > 1 &&
    cancellable &&
    cancelledAt === null &&
    !instantRefunded &&
    minCliffTime !== null &&
    nowSecs < minCliffTime &&
    milestoneReleasedCount === 0
  );
}

