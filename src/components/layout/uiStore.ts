import { useSyncExternalStore } from "react";

/** Prefill data for globally-opened quick-create modals. */
export interface QuickModalState {
  kind: "customer" | "rep" | "list" | "request" | "payment";
  customerId?: string;
  representativeId?: string;
  listId?: string;
}

interface UiState {
  quickModal: QuickModalState | null;
  moreSheet: boolean;
}

let state: UiState = { quickModal: null, moreSheet: false };
const listeners = new Set<() => void>();

function set(patch: Partial<UiState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUiStore<T>(selector: (s: UiState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

export const uiActions = {
  openCustomerModal: () => set({ quickModal: { kind: "customer" } }),
  openRepModal: () => set({ quickModal: { kind: "rep" } }),
  openListModal: () => set({ quickModal: { kind: "list" } }),
  openRequestModal: (prefill?: { customerId?: string; representativeId?: string; listId?: string }) =>
    set({ quickModal: { kind: "request", ...prefill } }),
  openPaymentModal: (prefill?: { representativeId?: string }) =>
    set({ quickModal: { kind: "payment", ...prefill } }),
  closeQuickModal: () => set({ quickModal: null }),
  setMoreSheet: (open: boolean) => set({ moreSheet: open }),
};
