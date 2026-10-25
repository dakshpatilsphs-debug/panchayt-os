import type { SocietySettings, Usage } from "./types";
import { bytesHuman, monthLabel } from "./util";
import { loadSettings, loadUsage, sendMailDoc, setAlertSent, listPayments } from "./store";

/**
 * Fires once when the payments collection crosses 90% of the soft limit.
 * Flow: e-mail via the Firebase no-reply pipeline + a mailto draft fallback.
 */
export async function checkStorageAlert(): Promise<{ fired: boolean; mailto: string }> {
  const settings = await loadSettings();
  const usage = await loadUsage();
  const limitBytes = Math.max(1, settings.usageLimitMB) * 1024 * 1024;
  const pct = (used: number) => (limitBytes ? (used / limitBytes) * 100 : 0);
  if (pct(usage.estBytes) < 90 || usage.limitAlertSent) return { fired: false, mailto: "" };

  const dispatched = await dispatchLimitEmail(settings, usage);
  await setAlertSent(true);
  return { fired: true, mailto: dispatched.mailto };
}

export async function dispatchLimitEmail(
  settings: SocietySettings,
  usage: Usage
): Promise<{ queued: boolean; mailto: string }> {
  const limitBytes = Math.max(1, settings.usageLimitMB) * 1024 * 1024;
  const percent = Math.min(100, Math.round((usage.estBytes / limitBytes) * 100));
  const to = settings.adminEmail;
  const subject = `[Action needed · ${percent}%] ${settings.societyName} — Firestore storage near limit`;

  const text = [
    `The payments collection of ${settings.societyName} has reached ${percent}% of the configured soft limit (${settings.usageLimitMB} MB).`,
    "",
    `Payment records stored : ${usage.paymentsCount}`,
    `Estimated collection size : ${bytesHuman(usage.estBytes)} of ${settings.usageLimitMB} MB`,
    "",
    "What to do now:",
    "1. Open the Society Khata app → Admin → Archive.",
    "2. Download the Excel register and the JSON backup (they save to this computer).",
    "3. Confirm the archive, then run 'Purge Firestore' — old payment records are removed and "
    + " Firestore keeps working on the free tier.",
    "",
    "You receive this because the app is configured to alert at 90% of the soft limit.",
    `Last measured: ${usage.lastChecked || "just now"} · month with most recent records: ${
      (await latestMonths()) || "—"
    }`,
  ].join("\n");

  const html = [
    '<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto">',
    `<h2 style="color:#1D4D3B">${settings.societyName}</h2>`,
    `<p>The <b>payments</b> collection has reached <b style="color:#A93B32">${percent}%</b> of the configured soft limit of <b>${settings.usageLimitMB} MB</b>.</p>`,
    "<ul>",
    `<li>Payment records stored: <b>${usage.paymentsCount}</b></li>`,
    `<li>Estimated collection size: <b>${bytesHuman(usage.estBytes)}</b></li>`,
    "</ul>",
    "<p><b>What to do now</b></p>",
    "<ol>",
    "<li>Open the app → <b>Admin → Archive</b>.</li>",
    "<li>Download the <b>Excel register</b> and the <b>JSON backup</b> to this computer.</li>",
    "<li>Confirm the archive, then run <b>Purge Firestore</b>.</li>",
    "</ol>",
    '<p style="color:#71806F;font-size:12px">Society Khata · automated no-reply alert</p>',
    "</div>",
  ].join("\n");

  const mailto = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  const queued = (await sendMailDoc(to, subject, html, text)) === "queued";
  return { queued, mailto };
}

async function latestMonths(): Promise<string> {
  try {
    const payments = await listPayments();
    if (!payments.length) return "";
    return monthLabel(payments[0].month);
  } catch {
    return "";
  }
}
