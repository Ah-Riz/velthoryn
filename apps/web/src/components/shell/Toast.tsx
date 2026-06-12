"use client";

import { toast as sonnerToast } from "sonner";

type ToastType = "success" | "error" | "info";

export function useToast() {
  const toast = (message: string, type: ToastType = "info") => {
    if (type === "success") sonnerToast.success(message);
    else if (type === "error") sonnerToast.error(message);
    else sonnerToast(message);
  };
  return { toast };
}
