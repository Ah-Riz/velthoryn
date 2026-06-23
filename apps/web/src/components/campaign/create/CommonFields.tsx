"use client";

import {
  CARD,
  INPUT_ERR,
  Field,
  Input,
  SectionHeader,
  ToggleCard,
} from "./shared";
import { TokenPicker } from "./TokenPicker";

type FormErrors = Record<string, string | null>;

export function CommonFields({
  mintAddress,
  onMintAddressChange,
  amount,
  onAmountChange,
  beneficiary,
  onBeneficiaryChange,
  campaignId: _campaignId,
  onCampaignIdChange: _onCampaignIdChange,
  cancellable,
  onCancellableChange,
  mintDecimals,
  mintLoading,
  formErrors,
  tokenCaption,
}: {
  mintAddress: string;
  onMintAddressChange: (value: string) => void;
  amount: string;
  onAmountChange: (value: string) => void;
  beneficiary: string;
  onBeneficiaryChange: (value: string) => void;
  campaignId: string;
  onCampaignIdChange: (value: string) => void;
  cancellable: boolean;
  onCancellableChange: (value: boolean) => void;
  mintDecimals: number | null;
  mintLoading: boolean;
  formErrors: FormErrors;
  tokenCaption: string;
}) {
  return (
    <div className="space-y-5">
      <div className={`${CARD} space-y-4 p-5`}>
        <SectionHeader title="Token Details" caption={tokenCaption} />
        <TokenPicker
          mintAddress={mintAddress}
          onMintAddressChange={onMintAddressChange}
          mintDecimals={mintDecimals}
          mintLoading={mintLoading}
          error={formErrors.mintAddress}
          helperText="Choose a mint from your wallet or paste one manually."
        />
        <Field
          label={`Amount${mintDecimals !== null ? ` (${mintDecimals} decimals)` : ""}`}
          inputId="field-amount"
          input={
            <Input
              id="field-amount"
              type="text"
              placeholder={mintDecimals !== null ? "e.g. 1000" : "e.g. 1000000000 (raw)"}
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              aria-invalid={!!formErrors.amount}
              className={`bg-muted text-[13px] text-foreground border-foreground/[0.08] focus-visible:border-foreground/20 focus-visible:ring-0 placeholder:text-muted-foreground ${formErrors.amount ? INPUT_ERR : ""}`}
            />
          }
          error={formErrors.amount}
        />
      </div>

      <div className={`${CARD} space-y-4 p-5`}>
        <SectionHeader title="Recipient" caption="Wallet that will receive the vested tokens" />
        <Field
          label="Beneficiary Wallet"
          inputId="field-beneficiary"
          input={
            <Input
              id="field-beneficiary"
              type="text"
              placeholder="Recipient wallet address"
              value={beneficiary}
              onChange={(e) => onBeneficiaryChange(e.target.value)}
              aria-invalid={!!formErrors.beneficiary}
              className={`bg-muted font-mono text-[13px] text-foreground border-foreground/[0.08] focus-visible:border-foreground/20 focus-visible:ring-0 placeholder:text-muted-foreground ${formErrors.beneficiary ? INPUT_ERR : ""}`}
            />
          }
          error={formErrors.beneficiary}
        />
      </div>

      <div className="space-y-3">
        <ToggleCard
          checked={cancellable}
          onChange={onCancellableChange}
          title="Cancellable"
          body="Creator can cancel and reclaim unvested tokens after a 7-day grace period. Already-vested tokens remain permanently claimable by recipients."
        />
      </div>
    </div>
  );
}
