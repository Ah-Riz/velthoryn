import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-4">Velthoryn</h1>
      <p className="text-lg text-gray-400 mb-8">
        Merkle-compressed token vesting · Cliff · Linear · Milestone
      </p>
      <div className="flex gap-4">
        <Link
          href="/campaign/create"
          className="px-6 py-3 bg-purple-600 rounded-lg hover:bg-purple-700 transition"
        >
          Create Campaign
        </Link>
        <Link
          href="/campaign"
          className="px-6 py-3 border border-gray-600 rounded-lg hover:border-gray-400 transition"
        >
          View Campaigns
        </Link>
      </div>
    </main>
  );
}
