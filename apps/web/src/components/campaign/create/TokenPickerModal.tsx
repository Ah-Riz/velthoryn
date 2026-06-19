"use client";

import { useEffect, useRef, useState } from "react";
import { POPULAR_TOKENS } from "@/lib/constants/popular-tokens";
import { useWalletTokens } from "@/hooks/useWalletTokens";
import { useTokenMetadata } from "@/hooks/useTokenMetadata";
import { useToast } from "@/components/shell/Toast";
import { WRAPPED_SOL_MINT_ADDRESS } from "@/lib/sol/auto-wrap";
import { solscanTokenUrl } from "@/lib/sol/cluster";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { WrapSolModal } from "./WrapSolModal";

function shortenMint(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : addr;
}

function LetterAvatar({ symbol }: { symbol: string }) {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-line text-[12px] font-bold text-foreground/60">
      {symbol.charAt(0).toUpperCase()}
    </div>
  );
}

export function TokenPickerModal({
  open,
  onClose,
  onSelect,
  selectedMint,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (mint: string, decimals: number, autoWrap?: boolean) => void;
  selectedMint: string;
}) {
  const [search, setSearch] = useState("");
  const [showWrapModal, setShowWrapModal] = useState(false);
  const { toast } = useToast();
  const { tokens: walletTokens, loading: walletLoading, error: walletError, refetch: refetchWalletTokens } = useWalletTokens();
  const { metadata: customToken, loading: customLoading, error: customError } = useTokenMetadata(search);
  const walletLoadingRef = useRef(walletLoading);
  useEffect(() => { walletLoadingRef.current = walletLoading; }, [walletLoading]);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    // Trigger fetch if provider hasn't loaded tokens yet and isn't already fetching
    if (!walletLoadingRef.current) void refetchWalletTokens();
  }, [open, refetchWalletTokens]);

  const query = search.trim().toLowerCase();
  const filteredPopular = POPULAR_TOKENS.filter(
    (t) => t.symbol.toLowerCase().includes(query) || t.name.toLowerCase().includes(query) || t.mint.includes(search.trim()),
  );
  const nativeMint = WRAPPED_SOL_MINT_ADDRESS;
  const wsolEntry = walletTokens.find(
    (t) => t.mintAddress === nativeMint && !t.isNativeSol && Number(t.uiAmount) > 0,
  );
  const filteredWallet = walletTokens.filter(
    (t) => !t.isNativeSol &&
      t.mintAddress !== nativeMint &&
      !POPULAR_TOKENS.some((p) => p.mint === t.mintAddress) &&
      (t.mintAddress.includes(search.trim())),
  );

  const walletLoaded = walletTokens.length > 0;

  function getPopularBalance(token: { mint: string; symbol: string; isNativeSol?: boolean; isWrappedSol?: boolean }): string {
    if (walletLoading) return "···";
    if (!walletLoaded) return "–";
    if (token.isNativeSol) {
      const nativeEntry = walletTokens.find((w) => w.isNativeSol);
      return nativeEntry ? nativeEntry.uiAmount : "0";
    }
    if (token.isWrappedSol) {
      const wrappedEntry = walletTokens.find((w) => w.mintAddress === token.mint && !w.isNativeSol);
      return wrappedEntry ? wrappedEntry.uiAmount : "0";
    }
    const walletMatch = walletTokens.find((w) => w.mintAddress === token.mint && !w.isNativeSol);
    return walletMatch ? walletMatch.uiAmount : "0";
  }

  function handleTokenClick(mint: string, decimals: number, autoWrap?: boolean) {
    onSelect(mint, decimals, autoWrap);
    onClose();
  }

  async function handleWrapSuccess() {
    setShowWrapModal(false);
    toast("wSOL is ready! Select it from the token list.", "success");
    await refetchWalletTokens();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          className="max-w-md overflow-hidden border-foreground/[0.08] bg-muted p-0"
          showCloseButton={false}
          style={{ maxHeight: "80vh", display: "flex", flexDirection: "column" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <DialogTitle className="text-[15px] font-medium text-foreground">Choose token</DialogTitle>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void refetchWalletTokens()}
                disabled={walletLoading}
                className="rounded-full border border-foreground/[0.08] px-2.5 py-1 text-[10px] font-medium text-muted-foreground transition hover:border-foreground/20 hover:text-foreground disabled:opacity-40"
              >
                {walletLoading ? "···" : "↻ Refresh"}
              </button>
              <button onClick={onClose} className="text-muted-foreground transition hover:text-foreground">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>

          <div className="mx-5 border-t border-foreground/[0.08]" />

          {/* Search */}
          <div className="px-5 pt-3 pb-2">
            <div className="flex items-center gap-2 rounded-lg border border-foreground/[0.08] bg-secondary px-3 py-2.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
              </svg>
              <input
                type="text"
                placeholder="Name, symbol or paste address..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
                autoFocus
              />
            </div>
          </div>

          {walletError && !walletLoading && (
            <div className="mx-5 flex items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <span className="text-[11px] text-amber-700 dark:text-amber-400">Wallet tokens unavailable — select from popular list or retry</span>
              <button
                type="button"
                onClick={() => void refetchWalletTokens()}
                className="shrink-0 text-[11px] text-violet-700 dark:text-violet-400 hover:text-violet-700 dark:text-violet-300 hover:underline"
              >
                Retry
              </button>
            </div>
          )}

          {/* Token List */}
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {filteredPopular.length > 0 && (
              <div className="px-2 pt-2 pb-1">
                <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Popular</p>
              </div>
            )}
            {filteredPopular.map((token) => {
              const balance = getPopularBalance(token);
              return (
                <button
                  key={token.mint + token.symbol}
                  type="button"
                  onClick={() => handleTokenClick(token.mint, token.decimals, false)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    selectedMint === token.mint ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.04]"
                  }`}
                >
                  {token.logoURI ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={token.logoURI} alt={token.symbol} className="h-8 w-8 rounded-full" />
                  ) : (
                    <LetterAvatar symbol={token.symbol} />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-foreground">{token.symbol}</span>
                      {token.isNativeSol && (
                        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">Native</span>
                      )}
                      {token.isWrappedSol && (
                        <span className="rounded-full bg-foreground/[0.08] px-2 py-0.5 text-[10px] text-foreground/60">Wrapped</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="truncate text-[11px] text-muted-foreground">{token.name}</span>
                      <a
                        href={solscanTokenUrl(token.mint)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
                        </svg>
                      </a>
                    </div>
                  </div>
                  <span className="text-[12px] text-muted-foreground">{balance}</span>
                </button>
              );
            })}

            {wsolEntry && (
              <button
                type="button"
                onClick={() => handleTokenClick(wsolEntry.mintAddress, wsolEntry.decimals ?? 9, false)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.04]"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-line text-[12px] font-bold text-foreground/60">W</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-foreground">wSOL</span>
                    <span className="rounded-full bg-foreground/[0.08] px-2 py-0.5 text-[10px] text-foreground/50">Wrapped</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">Wrapped SOL in wallet</span>
                </div>
                <span className="text-[12px] text-muted-foreground">{wsolEntry.uiAmount}</span>
              </button>
            )}

            {filteredWallet.length > 0 && (
              <div className="px-2 pt-4 pb-1">
                <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Your Wallet Tokens ({filteredWallet.length})
                </p>
              </div>
            )}
            {walletLoading && filteredWallet.length === 0 && (
              <div className="space-y-2 px-2 pt-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-foreground/[0.05]" />
                ))}
              </div>
            )}
            {filteredWallet.map((token) => (
              <button
                key={token.mintAddress}
                type="button"
                onClick={() => handleTokenClick(token.mintAddress, token.decimals ?? 0)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  selectedMint === token.mintAddress ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.04]"
                }`}
              >
                <LetterAvatar symbol={token.mintAddress.charAt(0)} />
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-medium text-foreground">{shortenMint(token.mintAddress)}</span>
                  <div className="flex items-center gap-1">
                    <span className="truncate text-[11px] text-muted-foreground">{shortenMint(token.mintAddress)}</span>
                    <a
                      href={solscanTokenUrl(token.mintAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
                      </svg>
                    </a>
                  </div>
                </div>
                <span className="text-[12px] text-muted-foreground">{Number(token.uiAmount) > 0 ? token.uiAmount : "–"}</span>
              </button>
            ))}

            {customToken && !filteredPopular.some((p) => p.mint === customToken.mint) && !filteredWallet.some((w) => w.mintAddress === customToken.mint) && (
              <button
                type="button"
                onClick={() => handleTokenClick(customToken.mint, customToken.decimals)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.04]"
              >
                <LetterAvatar symbol={customToken.symbol} />
                <div className="flex-1">
                  <span className="text-[13px] font-medium text-foreground">{customToken.symbol}</span>
                  <span className="ml-2 text-[11px] text-muted-foreground">{customToken.decimals} decimals</span>
                </div>
              </button>
            )}
            {customLoading && <p className="px-3 py-2 text-[12px] text-muted-foreground">Looking up token...</p>}
            {customError && search.length >= 32 && <p className="px-3 py-2 text-[12px] text-red-700 dark:text-red-400">{customError}</p>}

            {!walletLoading && !customLoading && filteredPopular.length === 0 && filteredWallet.length === 0 && !customToken && (
              <div className="flex flex-col items-center py-8 text-muted-foreground">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mb-2 opacity-50">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
                </svg>
                <p className="text-[13px]">No tokens found</p>
              </div>
            )}
          </div>

          {/* Footer: Wrap/Unwrap */}
          <div className="border-t border-foreground/[0.08] px-5 py-3">
            <button
              type="button"
              onClick={() => setShowWrapModal(true)}
              className="w-full rounded-xl border border-foreground/[0.1] bg-secondary px-4 py-2.5 text-[13px] font-medium text-foreground/70 transition hover:bg-foreground/[0.05]"
            >
              ⇄ Wrap / Unwrap SOL
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <WrapSolModal
        isOpen={showWrapModal}
        onClose={() => setShowWrapModal(false)}
        onSuccess={handleWrapSuccess}
      />
    </>
  );
}
