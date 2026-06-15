"use client";

import { NoticeCard } from "@/components/campaign/create/shared";
import { VestingTypeSelector } from "@/components/campaign/create/VestingTypeSelector";

export default function CreateStreamPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-12">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight text-foreground">
          Create Vesting Stream
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-7 text-muted-foreground">
          Choose a vesting schedule type. Each type determines how and when tokens unlock for the recipient.
        </p>
      </div>

      <VestingTypeSelector />
      <NoticeCard
        title="Creation Flow"
        body="Single streams fund the vault immediately. Bulk campaigns (available for Cliff and Linear) create the Merkle tree first, then fund in a second step."
      />
    </div>
  );
}
