"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { readAdminSessionKey, writeAdminSessionKey } from "@/lib/admin-session";

export default function AdminEntryPage() {
  const router = useRouter();
  const [adminKey, setAdminKey] = useState("");
  const [hasSavedKey, setHasSavedKey] = useState(false);

  useEffect(() => {
    const savedKey = readAdminSessionKey();
    if (savedKey) {
      setHasSavedKey(true);
    }
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedKey = adminKey.trim();

    if (!trimmedKey) {
      return;
    }

    writeAdminSessionKey(trimmedKey);
    router.push("/admin/waitlist");
  }

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-lg items-center">
        <section className="w-full rounded-3xl border border-foreground/10 bg-foreground/[0.03] p-8 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-emerald-200">
            Admin Access
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Masuk ke waitlist admin</h1>
          <p className="mt-3 text-sm leading-6 text-secondary-foreground">
            Masukkan <span className="font-mono text-foreground">ADMIN_API_KEY</span> untuk buka daftar waitlist.
          </p>

          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">Admin key</span>
              <input
                type="password"
                value={adminKey}
                onChange={(event) => setAdminKey(event.target.value)}
                placeholder="Paste ADMIN_API_KEY"
                className="h-12 rounded-2xl border border-foreground/10 bg-muted px-4 text-sm text-foreground outline-none transition focus:border-violet-400/60"
                suppressHydrationWarning
              />
            </label>

            <button
              type="submit"
              className="h-12 w-full rounded-2xl bg-violet-700 dark:bg-violet-600 px-5 text-sm font-medium text-white transition hover:bg-violet-600 dark:hover:bg-violet-500"
              suppressHydrationWarning
            >
              Continue
            </button>
          </form>

          {hasSavedKey ? (
            <button
              type="button"
              onClick={() => router.push("/admin/waitlist")}
              className="mt-4 h-11 w-full rounded-2xl border border-foreground/10 bg-foreground/5 px-5 text-sm font-medium text-foreground transition hover:bg-foreground/10"
              suppressHydrationWarning
            >
              Use saved key
            </button>
          ) : null}
        </section>
      </div>
    </main>
  );
}
