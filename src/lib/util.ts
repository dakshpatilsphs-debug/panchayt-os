import type { Member, Payment } from "./types";

export const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n || 0);

export const inr0 = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  if (!y || !mo) return m;
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(new Date(y, mo - 1, 1));
}

export function fmtDate(iso?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

export function fmtDateTime(iso?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso)
  );
}

export function bytesHuman(b: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i > 0 && v < 10 ? 1 : 0)} ${units[i]}`;
}

/** Approximate storage footprint of a document (JSON-serialised). */
export function byteLen(obj: unknown): number {
  return new TextEncoder().encode(JSON.stringify(obj ?? {})).length;
}

/** SK-202610-K7Q2 — receipt reference shown to residents. */
export function newPaymentId(): string {
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SK-${ym}-${rand}`;
}

export function memberId(wing: string, flat: string): string {
  return `${wing.trim()}-${flat.trim()}`;
}

/** Free, open UPI deep-link — works with GPay / PhonePe / Paytm / bank apps. */
export function buildUpiUri(o: { vpa: string; payee: string; amount: number; note: string }): string {
  const q = new URLSearchParams({ pa: o.vpa, pn: o.payee, am: String(o.amount), cu: "INR", tn: o.note });
  return `upi://pay?${q.toString()}`;
}

export const utrLooksValid = (s: string) => /^\d{12}$/.test(s.trim());

/** Union of configured wings and wings that actually have flats/records. */
export function wingsInSettingsAndData(settingsWings: string[], members: Member[]): string[] {
  const set = new Set<string>(settingsWings);
  members.forEach((m) => m.wing && set.add(m.wing));
  return Array.from(set);
}

export function availableMonths(payments: Payment[]): string[] {
  const set = new Set<string>(payments.map((p) => p.month).filter(Boolean));
  return Array.from(set).sort().reverse();
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, "").slice(0, 28) || "society";
}
