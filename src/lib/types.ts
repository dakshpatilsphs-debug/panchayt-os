export type PaymentStatus = "pending" | "verified" | "rejected";
/** Payments move over the society's own UPI QR — no third-party gateway rail. */
export type PayMethod = "upi";

export interface SocietySettings {
  societyName: string;
  address1: string;
  address2: string;
  regNo: string;
  upiId: string;
  payeeName: string;
  wings: string[];
  adminPin: string;
  adminEmail: string;
  /** Soft storage limit for the payments collection, in MiB. Alert fires at 90%. */
  usageLimitMB: number;
  updatedAt?: string;
}

export interface Member {
  id: string; // "A-102"
  wing: string;
  flat: string;
  floor?: number;
  ownerName: string;
  phone: string;
  monthlyMaintenance: number;
  dueBalance: number;
  active: boolean;
}

export interface Contact {
  id: string;
  name: string;
  role: string;
  phone: string;
  category: "committee" | "staff" | "emergency" | "services";
  notes?: string;
}

export const DEFAULT_CONTACTS: Contact[] = [
  { id: "c-1", name: "Sunita Iyer", role: "Society Chairman (Flat B-601)", phone: "9820022334", category: "committee", notes: "General inquiries & approvals" },
  { id: "c-2", name: "Rohan Deshpande", role: "Secretary (Flat A-402)", phone: "9820011223", category: "committee", notes: "Meetings & society correspondence" },
  { id: "c-3", name: "Vikram Khan", role: "Treasurer (Flat C-303)", phone: "9820033445", category: "committee", notes: "Maintenance accounts & receipts" },
  { id: "c-4", name: "Security Gate #1", role: "Main Gate Security", phone: "9820044556", category: "staff", notes: "24/7 Main Entrance Security" },
  { id: "c-5", name: "Ramesh Electrician", role: "Society Electrician", phone: "9820055667", category: "services", notes: "On-call 8 AM - 8 PM" },
  { id: "c-6", name: "Sunil Plumber", role: "Society Plumber", phone: "9820077889", category: "services", notes: "On-call for leakages & pumps" },
  { id: "c-7", name: "Schindler / OTIS Lift Helpline", role: "Lift Breakdown & Entrapment", phone: "18002008888", category: "emergency", notes: "24/7 Toll-free Emergency" },
  { id: "c-8", name: "Local Police Station", role: "Police Control Room", phone: "112", category: "emergency", notes: "National Emergency Helpline" },
];

export interface ScreenshotMeta {
  /** When the resident attached the screenshot (ISO). */
  attachedAt: string;
  /** 12-digit UTR read out of the screenshot, when OCR found one. */
  ocrUtr?: string;
  /** Amount read out of the screenshot, when OCR found one. */
  ocrAmount?: number;
  /** How strongly what the OCR read agrees with this receipt. */
  verdict: "matched" | "partial" | "unreadable";
}

export interface Payment {
  id: string; // "SK-202610-K7Q2"
  memberId: string;
  wing: string;
  flat: string;
  ownerName: string;
  month: string; // "2026-10"
  amount: number;
  /** Portion of the amount that settled past maintenance dues. */
  maintenancePart: number;
  /** Anything paid above the dues — a voluntary contribution. */
  donationPart: number;
  method: PayMethod;
  /** UPI UTR (12 digits). */
  utr: string;
  status: PaymentStatus;
  createdAt: string; // ISO
  verifiedAt?: string;
  note?: string;
  /** Payment screenshot attached by the resident (compressed JPEG data URL) — proof. */
  screenshot?: string;
  /** What the built-in screenshot reader (OCR) found in the attached screenshot. */
  screenshotMeta?: ScreenshotMeta;
  /** True once this receipt's maintenancePart has been subtracted from dues — guards double-settling. */
  dueSettled?: boolean;
}

export interface Usage {
  paymentsCount: number;
  estBytes: number;
  limitAlertSent: boolean;
  lastChecked: string;
}

export type NoticeTone = "info" | "warn" | "event";

/** A committee-posted bulletin on the society's notice board. */
export interface Notice {
  id: string;
  title: string;
  body: string;
  tone: NoticeTone;
  createdAt: string; // ISO
  updatedAt?: string;
  /** Surfaced at the top of the board and on the sign-in page. */
  pinned?: boolean;
  /** Target scope: all floors, specific wing, specific floor, or specific flat */
  targetType?: "all" | "wing" | "floor" | "flat";
  targetWing?: string;
  targetFloor?: number;
  targetFlat?: string;
}

export const DEFAULT_SETTINGS: SocietySettings = {
  societyName: "Shanti Villa CHS Ltd.",
  address1: "Plot 14, Saraswati Lane, Karve Nagar",
  address2: "Pune, Maharashtra 411052",
  regNo: "MH/PUNE/HSG/0721/2013",
  upiId: "shantivillachs@upi",
  payeeName: "Shanti Villa CHS",
  wings: ["A", "B", "C"],
  adminPin: "2408",
  adminEmail: (import.meta.env.VITE_ADMIN_EMAIL as string | undefined) || "dakshpatil.sphs@gmail.com",
  usageLimitMB: 512,
};
