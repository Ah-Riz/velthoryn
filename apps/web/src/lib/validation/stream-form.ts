import { PublicKey } from "@solana/web3.js";

export function validatePublicKey(value: string): string | null {
  if (!value.trim()) return "Required.";
  try {
    new PublicKey(value.trim());
    return null;
  } catch {
    return "Invalid Solana address.";
  }
}

export function validateAmount(value: string): string | null {
  return validateAmountWithDecimals(value, null);
}

export function validateAmountWithDecimals(
  value: string,
  mintDecimals: number | null,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Required.";

  if (mintDecimals === null) {
    if (!/^\d+$/.test(trimmed)) return "Must be a positive integer (no decimals).";
    try {
      if (BigInt(trimmed) <= 0n) return "Must be greater than zero.";
    } catch {
      return "Invalid number.";
    }
    return null;
  }

  if (!/^\d+(\.\d+)?$/.test(trimmed)) return "Must be a positive number.";

  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > mintDecimals) {
    return `Supports up to ${mintDecimals} decimal places.`;
  }

  const normalized = `${whole}${frac.padEnd(mintDecimals, "0")}`.replace(/^0+/, "") || "0";
  try {
    if (BigInt(normalized) <= 0n) return "Must be greater than zero.";
  } catch {
    return "Invalid number.";
  }
  return null;
}

export function validateCampaignId(value: string): string | null {
  if (!value.trim()) return "Required.";
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return "Must be a positive integer.";
  return null;
}

export function validateSchedule(
  startUnix: number,
  cliffUnix: number,
  endUnix: number,
  releaseType: number,
): string | null {
  if (isNaN(startUnix) || isNaN(cliffUnix) || isNaN(endUnix)) return "All dates are required.";
  if (cliffUnix < startUnix) return "Cliff time must be on or after start time.";
  if (endUnix < cliffUnix) return "End time must be on or after cliff time.";
  if (cliffUnix - startUnix > 0 && cliffUnix - startUnix < 60)
    return "Cliff must be at least 60 seconds after start (Solana clock tolerance).";
  if (releaseType === 0 && endUnix !== cliffUnix)
    return "For cliff vesting, end time should equal cliff time.";
  if (releaseType === 2 && endUnix !== cliffUnix)
    return "For milestone vesting, end time should equal unlock time.";
  return null;
}

export function validateMilestoneIdx(value: string): string | null {
  if (!value.trim()) return "Required.";
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 255) return "Must be 0–255.";
  return null;
}

export type FormErrors = Record<string, string | null>;

export function validateCreateStreamForm(form: {
  beneficiary: string;
  mintAddress: string;
  amount: string;
  mintDecimals: number | null;
  campaignId: string;
  startUnix: number;
  cliffUnix: number;
  endUnix: number;
  releaseType: number;
  milestoneIdx: string;
}): FormErrors {
  const errors: FormErrors = {};
  errors.beneficiary = validatePublicKey(form.beneficiary);
  errors.mintAddress = validatePublicKey(form.mintAddress);
  errors.amount = validateAmountWithDecimals(form.amount, form.mintDecimals);
  errors.campaignId = validateCampaignId(form.campaignId);
  errors.schedule = validateSchedule(form.startUnix, form.cliffUnix, form.endUnix, form.releaseType);
  if (form.releaseType === 2) {
    errors.milestoneIdx = validateMilestoneIdx(form.milestoneIdx);
  }
  return errors;
}

export function hasErrors(errors: FormErrors): boolean {
  return Object.values(errors).some((e) => e !== null && e !== undefined);
}
