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
  ownerName: string;
  phone: string;
  monthlyMaintenance: number;
  dueBalance: number;
  active: boolean;
}

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
