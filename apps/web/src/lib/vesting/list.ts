export type SenderStream = {
  totalSupply: number | string;
  totalClaimed: number | string;
  paused: boolean;
  cancelledAt: number | null;
};

export type RecipientLeaf = {
  amount: number | string;
  releaseType: number;
  cliffTime: number;
  endTime: number;
};

export type RecipientStream = {
  myClaimed: number | string;
  myLeaf: RecipientLeaf;
  paused: boolean;
  cancelledAt: number | null;
};

export type StreamStatus = "Active" | "Scheduled" | "Claimable" | "Claimed" | "Paused" | "Cancelled";

function toBigInt(value: number | string): bigint {
  return BigInt(String(value));
}

function vestedForRecipient(stream: RecipientStream, nowTs: bigint): bigint {
  const amount = toBigInt(stream.myLeaf.amount);
  const cliffTs = BigInt(stream.myLeaf.cliffTime);
  const endTs = BigInt(stream.myLeaf.endTime);
  const cancelledAt = stream.cancelledAt !== null ? BigInt(stream.cancelledAt) : null;
  const effectiveNow = cancelledAt !== null && cancelledAt < nowTs ? cancelledAt : nowTs;

  switch (stream.myLeaf.releaseType) {
    case 0:
      return effectiveNow >= cliffTs ? amount : 0n;
    case 1: {
      if (effectiveNow >= endTs) return amount;
      if (effectiveNow <= cliffTs) return 0n;
      const elapsed = effectiveNow - cliffTs;
      const duration = endTs - cliffTs;
      return duration > 0n ? (amount * elapsed) / duration : amount;
    }
    case 2:
      return effectiveNow >= cliffTs ? amount : 0n;
    default:
      return 0n;
  }
}

export function getRecipientClaimableAmount(
  stream: RecipientStream,
  nowTs: bigint,
): bigint {
  const claimed = toBigInt(stream.myClaimed);
  const vested = vestedForRecipient(stream, nowTs);
  return vested > claimed ? vested - claimed : 0n;
}

export function getSenderStreamStatus(stream: SenderStream): StreamStatus {
  const totalSupply = toBigInt(stream.totalSupply);
  const totalClaimed = toBigInt(stream.totalClaimed);

  if (stream.cancelledAt !== null) return "Cancelled";
  if (stream.paused) return "Paused";
  if (totalSupply > 0n && totalClaimed >= totalSupply) return "Claimed";
  return "Active";
}

export function getRecipientStreamStatus(
  stream: RecipientStream,
  nowTs: bigint,
): StreamStatus {
  const claimed = toBigInt(stream.myClaimed);
  const entitled = toBigInt(stream.myLeaf.amount);

  if (entitled > 0n && claimed >= entitled) return "Claimed";
  if (stream.cancelledAt !== null) return "Cancelled";
  if (stream.paused) return "Paused";

  const claimable = getRecipientClaimableAmount(stream, nowTs);
  if (claimable > 0n) return "Claimable";

  return "Scheduled";
}

export function getMultiLeafRecipientStreamStatus(
  streams: RecipientStream[],
  nowTs: bigint,
): StreamStatus {
  if (streams.length === 0) return "Scheduled";
  if (streams.length === 1) return getRecipientStreamStatus(streams[0], nowTs);

  const first = streams[0];
  const claimed = toBigInt(first.myClaimed);
  const totalEntitled = streams.reduce((sum, s) => sum + toBigInt(s.myLeaf.amount), 0n);

  if (totalEntitled > 0n && claimed >= totalEntitled) return "Claimed";
  if (first.cancelledAt !== null) return "Cancelled";
  if (first.paused) return "Paused";

  const totalVested = streams.reduce((sum, s) => sum + vestedForRecipient(s, nowTs), 0n);
  const claimable = totalVested > claimed ? totalVested - claimed : 0n;
  if (claimable > 0n) return "Claimable";

  return "Scheduled";
}

export function getMultiLeafClaimableAmount(
  streams: RecipientStream[],
  nowTs: bigint,
): bigint {
  if (streams.length === 0) return 0n;
  if (streams.length === 1) return getRecipientClaimableAmount(streams[0], nowTs);

  const claimed = toBigInt(streams[0].myClaimed);
  const totalVested = streams.reduce((sum, s) => sum + vestedForRecipient(s, nowTs), 0n);
  return totalVested > claimed ? totalVested - claimed : 0n;
}
