"use client";

// Sender Dashboard: create_campaign + fund_campaign
// Ref: research-week2.md §12.2 Days 4-5

export default function CreateCampaignPage() {
  return (
    <main className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">Create Campaign</h1>
      {/* TODO Week 3 Days 4-5:
          1. CSV upload → Server Action builds Merkle Root + Pinata pins proof
          2. create_campaign form (mint, totalSupply, root, releaseType, cliffTs, endTs)
          3. fund_campaign form after create succeeds
      */}
      <p className="text-gray-400">Campaign creation form — implementation in Week 3.</p>
    </main>
  );
}
