import { useSyncExternalStore } from "react";

/**
 * Quiet flat memory — no accounts, no PINs. When a resident picks a wing +
 * flat to pay, the store writes the flat id into localStorage and calls
 * `notifySession()`, so anything subscribed (the route gate, the history
 * page) re-renders once. Purely a browser-local convenience: the memory
 * survives reloads, and nothing about it private — anyone else on this
 * browser could change the flat by paying a receipt for themselves.
 */
const listeners = new Set<() => void>();
let cache: string | null = null;

function snapshot(): string {
  if (cache === null) {
    try {
      cache = localStorage.getItem("sk.session") ?? "";
    } catch {
      cache = "";
    }
  }
  return cache;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Call after writing/clearing "sk.session" anywhere in the app. */
export function notifySession(): void {
  cache = null;
  listeners.forEach((fn) => fn());
}

/** The remembered flat's memberId — "" when this browser has no memory yet. */
export function useSession(): string {
  return useSyncExternalStore(subscribe, snapshot, () => "");
}
