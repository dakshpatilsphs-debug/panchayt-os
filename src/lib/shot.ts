/**
 * Screenshot reader — proof of a really-done payment.
 *
 * The resident attaches the screenshot their UPI app shows after paying.
 * Everything runs offline in the browser:
 *   1. the image is downscaled + re-compressed so it fits comfortably inside a
 *      Firestore document (≤ ~480 KB before base64),
 *   2. Tesseract.js OCR (lazy-loaded, WASM) reads the text,
 *   3. the UTR (12 digits), the amount and a status word are pulled out and
 *      cross-checked against the receipt being paid.
 *
 * The verdict is a *hint for the treasurer*, never an automatic approval —
 * only the committee's verify click settles dues.
 */

export interface ShotMatch {
  utr: string;
  amount: number | null;
  statusWord: string | null;
  verdict: "matched" | "partial" | "unreadable";
}

/* ────────────────────────── image squeeze ────────────────────────── */

const MAX_EDGE = 1280;
// ≤ ~480 KB of raw JPEG → ~640 KB as a Firestore-safe base64 string.
const TARGET_BYTES = 480_000;

async function fileToBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    // Older Safari: fall back to <img>
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await new Promise<void>((ok, err) => {
        img.onload = () => ok();
        img.onerror = () => err(new Error("Couldn't read that image — try a JPG or PNG."));
      });
      return img as unknown as ImageBitmap;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function drawToJpeg(src: CanvasImageSource, w: number, h: number, quality: number): string {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(src, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}

/** Downscale + re-compress until the data URL fits the budget. */
export async function compressEvidence(file: File): Promise<string> {
  const bmp = await fileToBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  let url = drawToJpeg(bmp, w, h, 0.72);
  let q = 0.72;
  while (url.length > TARGET_BYTES && q > 0.4) {
    q -= 0.16;
    url = drawToJpeg(bmp, w, h, q);
  }
  if (url.length > TARGET_BYTES) url = drawToJpeg(bmp, Math.round(w * 0.8), Math.round(h * 0.8), 0.45);
  return url;
}

/* ────────────────────────── text mining ────────────────────────── */

/** UPI UTRs are 12 digits — screenshotted apps often space them in groups. */
export function extractUtr(text: string): string {
  const flat = text.replace(/[^\d\s]/g, " ");
  const spaced = flat.match(/\b\d{4}\s\d{4}\s\d{4}\b/);
  if (spaced) return spaced[0].replace(/\s/g, "");
  const plain = flat.match(/\b\d{12}\b/);
  return plain ? plain[0] : "";
}

const AMOUNT_RE =
  /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)|(?:\b(?:amount|amt|paid|total|debited|transferred)\b[^0-9]{0,8}([\d,]+(?:\.\d{1,2})?))/gi;

/** Rupee amounts the OCR read; prefers the value nearest `expected`. */
export function extractAmount(text: string, expected?: number): number | null {
  const cands: number[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const raw = m[1] ?? m[2];
    if (!raw) continue;
    const v = Math.round(Number(raw.replace(/,/g, "")) * 100) / 100;
    if (Number.isFinite(v) && v > 0 && v < 10_000_000) cands.push(v);
  }
  if (cands.length === 0) return null;
  if (expected != null) {
    const near = cands.filter((v) => Math.abs(v - expected) <= 1);
    if (near.length) return near[0];
  }
  return Math.max(...cands);
}

const STATUS_RE = /\b(paid|successful|success|completed|done|sent|debited|payment\s+successful)\b/i;

/** How the OCR reading agrees with the receipt cross-checks. */
export function judgeShot(shot: { utr: string; amount: number | null; statusWord: string | null }, expectedAmount: number): ShotMatch {
  const amountsOk = shot.amount != null && Math.abs(shot.amount - expectedAmount) <= 1;
  let verdict: ShotMatch["verdict"];
  if (shot.utr && amountsOk) verdict = "matched";
  else if (shot.utr || (amountsOk && shot.statusWord)) verdict = "partial";
  else verdict = "unreadable";
  return { ...shot, verdict };
}

/* ────────────────────────── OCR ────────────────────────── */

type Progress = (pct: number) => void;

let workerPromise: Promise<{ recognize: (img: string) => Promise<{ data: { text: string } }>; terminate?: () => Promise<void> }> | null = null;

async function ocrText(img: string, onProgress?: Progress): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  if (!workerPromise) {
    workerPromise = createWorker("eng", 1, {
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text" && onProgress) onProgress(Math.round((m.progress ?? 0) * 100));
      },
    }) as unknown as Promise<{ recognize: (img: string) => Promise<{ data: { text: string } }>; terminate?: () => Promise<void> }>;
  }
  const worker = await workerPromise;
  onProgress?.(1);
  const out = await worker.recognize(img);
  return out.data.text ?? "";
}

/**
 * The full pipeline: compress → OCR → pull out UTR / amount / status → judge.
 * `onProgress` reports OCR progress from 0–100 for the UI.
 */
export async function readPaymentScreenshot(
  file: File,
  expectedAmount: number,
  onProgress?: Progress
): Promise<{ dataUrl: string } & ShotMatch> {
  const dataUrl = await compressEvidence(file);
  let text = "";
  try {
    text = await ocrText(dataUrl, onProgress);
  } catch {
    // OCR is best-effort — the screenshot itself is still attached as evidence.
    return { dataUrl, ...judgeShot({ utr: "", amount: null, statusWord: null }, expectedAmount) };
  }
  const statusMatch = text.match(STATUS_RE);
  const shot = {
    utr: extractUtr(text),
    amount: expectedAmount > 0 ? extractAmount(text, expectedAmount) : extractAmount(text),
    statusWord: statusMatch ? statusMatch[1] : null,
  };
  return { dataUrl, ...judgeShot(shot, expectedAmount) };
}
