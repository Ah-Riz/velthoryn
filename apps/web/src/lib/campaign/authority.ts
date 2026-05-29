import { PublicKey } from "@solana/web3.js";

type AddressLike = PublicKey | string | null | undefined;

function toBase58(value: AddressLike): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.toBase58();
}

export function sameAddress(left: AddressLike, right: AddressLike): boolean {
  const leftAddress = toBase58(left);
  const rightAddress = toBase58(right);
  return leftAddress !== null && rightAddress !== null && leftAddress === rightAddress;
}

export function canPauseCampaign(params: {
  viewer: AddressLike;
  pauseAuthority: AddressLike;
  cancelledAt: bigint | null;
  totalSupply: bigint;
  totalClaimed: bigint;
}): boolean {
  return (
    params.cancelledAt === null &&
    params.totalClaimed < params.totalSupply &&
    sameAddress(params.viewer, params.pauseAuthority)
  );
}

export function canCancelCampaign(params: {
  viewer: AddressLike;
  cancelAuthority: AddressLike;
  cancellable: boolean;
  cancelledAt: bigint | null;
  totalSupply: bigint;
  totalClaimed: bigint;
}): boolean {
  return (
    params.cancellable &&
    params.cancelledAt === null &&
    params.totalClaimed < params.totalSupply &&
    sameAddress(params.viewer, params.cancelAuthority)
  );
}

export function canWithdrawUnvested(params: {
  viewer: AddressLike;
  creator: AddressLike;
  cancelledAt: bigint | null;
}): boolean {
  return params.cancelledAt !== null && sameAddress(params.viewer, params.creator);
}

export function canRotateRoot(params: {
  viewer: AddressLike;
  cancelAuthority: AddressLike;
  cancellable: boolean;
  cancelledAt: bigint | null;
  leafCount: number;
}): boolean {
  return (
    params.leafCount > 1 &&
    params.cancellable &&
    params.cancelledAt === null &&
    sameAddress(params.viewer, params.cancelAuthority)
  );
}

export function canReleaseMilestone(params: {
  viewer: AddressLike;
  creator: AddressLike;
  cancelledAt: bigint | null;
  releaseType: number;
  hasMilestoneLeaves?: boolean;
}): boolean {
  if (params.cancelledAt !== null) return false;
  if (!sameAddress(params.viewer, params.creator)) return false;
  return params.releaseType === 2 || (params.hasMilestoneLeaves ?? false);
}

export function canInstantRefund(params: {
  viewer: AddressLike;
  creator: AddressLike;
  cancellable: boolean;
  cancelledAt: bigint | null;
  instantRefunded: boolean;
  leafCount: number;
  minCliffTime: bigint | null;
  nowTs: bigint;
  totalSupply: bigint;
  totalClaimed: bigint;
  milestoneReleasedFlags: Uint8Array;
}): boolean {
  if (!params.cancellable) return false;
  if (params.cancelledAt !== null) return false;
  if (params.instantRefunded) return false;
  if (params.leafCount <= 1) return false;
  if (params.totalClaimed >= params.totalSupply) return false;
  if (!sameAddress(params.viewer, params.creator)) return false;
  if (params.minCliffTime === null) return false;
  if (params.nowTs >= params.minCliffTime) return false;
  if (params.milestoneReleasedFlags.some((b) => b !== 0)) return false;
  return true;
}

export function canCancelStream(params: {
  viewer: AddressLike;
  creator: AddressLike;
  cancellable: boolean;
  cancelledAt: bigint | null;
  totalSupply: bigint;
  totalClaimed: bigint;
  leafCount: number;
}): boolean {
  return (
    params.leafCount === 1 &&
    params.cancellable &&
    params.cancelledAt === null &&
    params.totalClaimed < params.totalSupply &&
    sameAddress(params.viewer, params.creator)
  );
}
