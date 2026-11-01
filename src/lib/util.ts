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

/** Derive floor number from flat string or floor property (e.g. 101 -> 1, 204 -> 2, 1002 -> 10). */
export function getFlatFloor(flat: string, explicitFloor?: number): number {
  if (explicitFloor != null && !Number.isNaN(explicitFloor)) {
    return explicitFloor;
  }
  const clean = flat.replace(/\D/g, "");
  if (!clean) return 1;
  const num = parseInt(clean, 10);
  if (num >= 100) {
    return Math.floor(num / 100);
  }
  if (num >= 10 && clean.length === 2) {
    return Math.floor(num / 10);
  }
  return num > 0 ? num : 0;
}

/** Human-readable floor label (e.g. 0 -> "Ground Floor", 1 -> "1st Floor", 2 -> "2nd Floor"). */
export function floorLabel(floor: number): string {
  if (floor === 0) return "Ground Floor";
  const j = floor % 10;
  const k = floor % 100;
  if (j === 1 && k !== 11) return `${floor}st Floor`;
  if (j === 2 && k !== 12) return `${floor}nd Floor`;
  if (j === 3 && k !== 13) return `${floor}rd Floor`;
  return `${floor}th Floor`;
}

/** Generate a list of flats for a given wing, number of floors, and flats per floor. */
export function generateFlatsList(opts: {
  wing: string;
  totalFloors: number;
  flatsPerFloor: number;
  startFloor?: number;
  defaultMaintenance?: number;
}): Array<{ wing: string; flat: string; floor: number; id: string; monthlyMaintenance: number }> {
  const { wing, totalFloors, flatsPerFloor, startFloor = 1, defaultMaintenance = 0 } = opts;
  const flats: Array<{ wing: string; flat: string; floor: number; id: string; monthlyMaintenance: number }> = [];
  const cleanWing = wing.trim().toUpperCase() || "A";

  for (let f = startFloor; f < startFloor + totalFloors; f++) {
    for (let i = 1; i <= flatsPerFloor; i++) {
      const flatNumStr = f === 0 ? `G${i}` : `${f * 100 + i}`;
      flats.push({
        wing: cleanWing,
        flat: flatNumStr,
        floor: f,
        id: memberId(cleanWing, flatNumStr),
        monthlyMaintenance: defaultMaintenance,
      });
    }
  }
  return flats;
}
