import { create } from "zustand";

// Client-only state (wallet/modal state separate from chain state in TanStack Query)
// Ref: research-week2.md §8.2 — Zustand + TanStack Query split
type AppStore = {
  selectedCampaignId: string | null;
  setSelectedCampaign: (id: string | null) => void;
};

export const useAppStore = create<AppStore>((set) => ({
  selectedCampaignId: null,
  setSelectedCampaign: (id) => set({ selectedCampaignId: id }),
}));
