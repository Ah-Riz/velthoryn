"use client";

// Recipient Dashboard: fetch proof from IPFS, compute vested, claim
// Ref: research-week2.md §12.2 Day 6

export default function CampaignPage({ params }: { params: { id: string } }) {
  return (
    <main className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">Campaign {params.id}</h1>
      {/* TODO Week 3 Day 6:
          1. Fetch IPFS proof by (treeRoot, beneficiary)
          2. Compute vested amount via bigint preview
          3. claim() button building the instruction
          4. Subscribe to Claimed event → TanStack Query invalidate
      */}
      <p className="text-gray-400">Recipient dashboard — implementation in Week 3.</p>
    </main>
  );
}
