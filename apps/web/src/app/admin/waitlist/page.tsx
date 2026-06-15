"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { clearAdminSessionKey, readAdminSessionKey } from "@/lib/admin-session";

type WaitlistRow = {
  id: number;
  email: string;
  createdAt: number;
};

type WaitlistResponse = {
  total: number;
  data: WaitlistRow[];
};

function formatJoinedAt(unixSeconds: number) {
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  }).format(new Date(unixSeconds * 1000));
}

export default function AdminWaitlistPage() {
  const router = useRouter();
  const [rows, setRows] = useState<WaitlistRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [adminKey, setAdminKey] = useState("");

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter((row) => row.email.toLowerCase().includes(normalized));
  }, [query, rows]);

  const loadWaitlist = useCallback(async (keyOverride?: string) => {
    const activeKey = keyOverride ?? adminKey.trim();

    if (!activeKey) {
      setError("Admin key tidak ditemukan. Masuk lagi dari /admin.");
      router.replace("/admin");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/waitlist", {
        headers: {
          "x-admin-key": activeKey,
        },
      });

      const payload = (await response.json()) as WaitlistResponse | { error?: string };

      if (!response.ok) {
        setRows([]);
        setLoaded(false);
        setError("error" in payload ? payload.error ?? "Gagal memuat waitlist." : "Gagal memuat waitlist.");
        return;
      }

      if (!("data" in payload)) {
        setRows([]);
        setLoaded(false);
        setError("Respons waitlist tidak valid.");
        return;
      }

      setRows(payload.data);
      setLoaded(true);
    } catch {
      setError("Tidak bisa menghubungi API waitlist.");
    } finally {
      setLoading(false);
    }
  }, [adminKey, router]);

  useEffect(() => {
    const savedKey = readAdminSessionKey().trim();

    if (!savedKey) {
      router.replace("/admin");
      return;
    }

    setAdminKey(savedKey);
    setReady(true);
    void loadWaitlist(savedKey);
  }, [loadWaitlist, router]);

  async function exportCsv() {
    const activeKey = adminKey.trim();
    if (!activeKey) {
      setError("Admin key tidak ditemukan. Masuk lagi dari /admin.");
      router.replace("/admin");
      return;
    }

    setExporting(true);
    setError(null);

    try {
      const response = await fetch("/api/waitlist?format=csv", {
        headers: {
          "x-admin-key": activeKey,
        },
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? "Gagal export CSV.");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "waitlist.csv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Tidak bisa export CSV.");
    } finally {
      setExporting(false);
    }
  }

  function handleLogout() {
    clearAdminSessionKey();
    router.replace("/admin");
  }

  if (!ready) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6 py-10">
          <div className="rounded-3xl border border-foreground/10 bg-foreground/[0.03] px-6 py-4 text-sm text-secondary-foreground">
            Checking admin session...
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10 lg:px-10">
        <header className="flex flex-col gap-4 rounded-3xl border border-foreground/10 bg-foreground/[0.03] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-emerald-200">
                Admin
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">Waitlist Inbox</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary-foreground">
                Lihat email waitlist yang masuk dari landing page, cari cepat, lalu export CSV untuk marketing follow-up.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
              <div className="rounded-2xl border border-foreground/10 bg-black/20 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Total loaded</div>
                <div className="mt-2 text-2xl font-semibold text-foreground">{rows.length}</div>
              </div>
              <div className="rounded-2xl border border-foreground/10 bg-black/20 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Filtered</div>
                <div className="mt-2 text-2xl font-semibold text-foreground">{filteredRows.length}</div>
              </div>
              <div className="rounded-2xl border border-foreground/10 bg-black/20 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Last action</div>
                <div className="mt-2 text-sm font-medium text-foreground">
                  {loaded ? "Fetched from API" : "Not loaded yet"}
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-2xl border border-foreground/10 bg-foreground/5 px-5 py-3 text-sm font-medium text-foreground transition hover:bg-foreground/10"
                suppressHydrationWarning
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        <section className="rounded-3xl border border-foreground/10 bg-foreground/[0.03] p-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="rounded-2xl border border-dashed border-foreground/10 bg-black/20 px-4 py-3 text-sm text-secondary-foreground">
              Session: <span className="font-mono text-foreground">saved in this browser tab</span>
            </div>
            <button
              type="button"
              onClick={() => void loadWaitlist()}
              disabled={loading}
              className="h-12 self-end rounded-2xl bg-violet-700 dark:bg-violet-600 px-5 text-sm font-medium text-white transition hover:bg-violet-600 dark:hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
              suppressHydrationWarning
            >
              {loading ? "Loading..." : "Load waitlist"}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={exporting}
              className="h-12 self-end rounded-2xl border border-foreground/10 bg-foreground/5 px-5 text-sm font-medium text-foreground transition hover:bg-foreground/10 disabled:cursor-not-allowed disabled:opacity-60"
              suppressHydrationWarning
            >
              {exporting ? "Exporting..." : "Export CSV"}
            </button>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">Search</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by email"
                className="h-12 rounded-2xl border border-foreground/10 bg-muted px-4 text-sm text-foreground outline-none transition focus:border-emerald-400/60"
                suppressHydrationWarning
              />
            </label>
            <div className="rounded-2xl border border-dashed border-foreground/10 bg-black/20 px-4 py-3 text-sm text-secondary-foreground">
              Route: <span className="font-mono text-foreground">/admin/waitlist</span>
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-3xl border border-foreground/10 bg-foreground/[0.03]">
          <div className="flex items-center justify-between border-b border-foreground/10 px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Entries</h2>
              <p className="mt-1 text-sm text-secondary-foreground">
                {loaded ? `${filteredRows.length} rows ready` : "Load waitlist to see entries"}
              </p>
            </div>
          </div>

          {loaded && filteredRows.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-secondary-foreground">
              Tidak ada email yang cocok dengan filter sekarang.
            </div>
          ) : !loaded ? (
            <div className="px-6 py-12 text-center text-sm text-secondary-foreground">
              Belum ada data ditampilkan. Masukkan admin key lalu klik <span className="text-foreground">Load waitlist</span>.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="border-b border-foreground/10 bg-black/20 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    <th className="px-6 py-4 font-medium">#</th>
                    <th className="px-6 py-4 font-medium">Email</th>
                    <th className="px-6 py-4 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, index) => (
                    <tr key={row.id} className="border-b border-foreground/5 text-sm text-foreground last:border-b-0">
                      <td className="px-6 py-4 text-secondary-foreground">{index + 1}</td>
                      <td className="px-6 py-4 font-mono">{row.email}</td>
                      <td className="px-6 py-4 text-secondary-foreground">{formatJoinedAt(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
