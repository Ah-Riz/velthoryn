/**
 * User-facing messages for VestingError (Anchor codes 6000+).
 * See docs/ERROR_MAP.md for tutorial-name mapping.
 */

export const VESTING_ERROR_CODES = {
  EmptyRoot: 6000,
  EmptyCampaign: 6001,
  ZeroAmount: 6002,
  MissingCancelAuthority: 6003,
  SameRoot: 6004,
  Unauthorized: 6005,
  OverFunded: 6006,
  MintMismatch: 6007,
  Overflow: 6008,
  CampaignPaused: 6009,
  UnauthorizedClaimer: 6010,
  InvalidSchedule: 6011,
  InvalidScheduleType: 6012,
  InvalidProof: 6013,
  MilestoneAlreadyClaimed: 6014,
  NothingToClaim: 6015,
  InsufficientVault: 6016,
  OverClaim: 6017,
  WrongVault: 6018,
  NotCancellable: 6019,
  AlreadyCancelled: 6020,
  NotPausable: 6021,
  AlreadyPaused: 6022,
  CampaignCancelled: 6023,
  NotPaused: 6024,
  CampaignCompleted: 6025,
  NotCancelled: 6026,
  GracePeriodActive: 6027,
  CannotClose: 6028,
  NotSingleStream: 6029,
  ProofTooLong: 6030,
  FullyVested: 6031,
  StreamExpired: 6032,
  MilestoneNotReleased: 6033,
  MilestoneAlreadyReleased: 6034,
} as const;

type ErrorKey = keyof typeof VESTING_ERROR_CODES;

const USER_MESSAGES: Record<ErrorKey, string> = {
  EmptyRoot: "Merkle root cannot be empty.",
  EmptyCampaign: "Campaign must have at least one recipient.",
  ZeroAmount: "Amount must be greater than zero.",
  MissingCancelAuthority: "Cancellable streams require a cancel authority.",
  SameRoot: "New Merkle root must differ from the current root.",
  Unauthorized: "You are not authorized for this action.",
  OverFunded: "Deposit would exceed the stream total supply.",
  MintMismatch: "Token mint does not match this campaign.",
  Overflow: "Amount calculation overflowed.",
  CampaignPaused: "Campaign is paused. Contact the creator.",
  UnauthorizedClaimer: "You are not the beneficiary of this stream.",
  InvalidSchedule: "Invalid schedule: start must be ≤ cliff ≤ end.",
  InvalidScheduleType: "Release type must be Cliff (0), Linear (1), or Milestone (2).",
  InvalidProof:
    "Schedule parameters do not match this stream. Use the exact times from when the stream was created.",
  MilestoneAlreadyClaimed: "This milestone was already claimed.",
  NothingToClaim: "Nothing to claim yet. Wait for more tokens to vest or you already claimed everything unlocked.",
  InsufficientVault: "Vault has insufficient tokens. Contact the campaign creator.",
  OverClaim: "Claim would exceed the total stream supply.",
  WrongVault: "Vault account does not match this campaign.",
  NotCancellable: "This stream was created as non-cancellable.",
  AlreadyCancelled: "Stream is already cancelled.",
  NotPausable: "This stream has no pause authority.",
  AlreadyPaused: "Stream is already paused.",
  CampaignCancelled: "Stream is cancelled; this action is blocked.",
  NotPaused: "Stream is not paused.",
  CampaignCompleted: "Stream is already fully claimed; this action is blocked.",
  NotCancelled: "Stream must be cancelled first.",
  GracePeriodActive: "Grace period is still active; unvested sweep not allowed yet.",
  CannotClose: "Claim record cannot be closed yet.",
  NotSingleStream: "This action only works on single-recipient streams.",
  ProofTooLong: "Merkle proof is too long for this campaign.",
  FullyVested: "Stream is fully vested; cancellation is not allowed.",
  StreamExpired: "This stream has ended; there is nothing left to claim.",
  MilestoneNotReleased:
    "This milestone has not been released yet. The creator must release it before you can claim.",
  MilestoneAlreadyReleased:
    "This milestone has already been released by the creator.",
};

function codeToHex(code: number): string {
  return `0x${code.toString(16)}`;
}

function matchVestingCode(raw: string): ErrorKey | null {
  const entries = Object.entries(VESTING_ERROR_CODES) as [ErrorKey, number][];

  for (const [name, code] of entries) {
    if (raw.includes(codeToHex(code))) {
      return name;
    }
  }

  // Longer names first so e.g. UnauthorizedClaimer wins over Unauthorized
  const byNameLength = [...entries].sort((a, b) => b[0].length - a[0].length);
  for (const [name] of byNameLength) {
    if (raw.includes(name)) {
      return name;
    }
  }

  return null;
}

/** Map Anchor / RPC errors to short user-facing strings. */
export function formatVestingError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  if (raw.includes("AccountNotInitialized") && raw.includes("source_ata")) {
    return "Your wallet does not have a token account for this mint. Create one with: spl-token create-account <MINT> --url devnet";
  }
  if (raw.includes("AccountNotInitialized")) {
    return "A required account is missing on-chain. The stream may not exist or was not funded.";
  }
  if (raw.includes("InsufficientFunds") || /\b0x1\b/.test(raw)) {
    return "Insufficient SOL for transaction fees. Try: solana airdrop 2 --url devnet";
  }
  if (raw.includes("User rejected")) {
    return "Transaction cancelled in wallet.";
  }

  const vestingKey = matchVestingCode(raw);
  if (vestingKey) {
    return USER_MESSAGES[vestingKey];
  }

  if (raw.includes("BlockhashNotFound") || raw.includes("TransactionExpiredBlockheightExceeded")) {
    return "Transaction expired. Please try again.";
  }

  if (raw.includes("Failed to fetch") || raw.includes("NetworkError") || raw.includes("ECONNREFUSED")) {
    return "Network error. Check your connection and try again.";
  }

  return raw;
}

const RETRYABLE_PATTERNS = [
  "BlockhashNotFound",
  "TransactionExpiredBlockheightExceeded",
  "Failed to fetch",
  "NetworkError",
  "ECONNREFUSED",
  "timeout",
  "ETIMEDOUT",
];

export function isRetryableError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return RETRYABLE_PATTERNS.some((p) => raw.includes(p));
}
