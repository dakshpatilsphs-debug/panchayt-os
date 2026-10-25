/**
 * Optional Firebase Cloud Functions layer.
 *
 * The app itself already handles the storage-limit flow from the client side
 * (no-reply alert → archive → purge) and the entire payment flow — UPI QR +
 * screenshot reader + duplicate-payment guards — runs in the browser, which
 * works on the FREE Spark plan with nothing deployed here.
 *
 * Deploy this folder *only if* your project is on the Blaze plan and you want:
 *   1. `usageWatch`  — a server-side check of `config/usage` every hour;
 *                      writes the no-reply alert into the `mail` collection even
 *                      if nobody opens the app that day.
 *   2. `onMailCreate`— delivers `mail` docs via plain SMTP (no third-party SaaS);
 *                      an open-source alternative to the Trigger Email extension.
 *
 * Setup:
 *   cd functions
 *   cp .env.example .env  (fill SMTP values)
 *   npm install
 *   firebase deploy --only functions
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();
const db = admin.firestore();

// ── 1. Scheduled guard: e-mail before anyone notices ──────────────────────────
exports.usageWatch = functions.pubsub
  .schedule("every 60 minutes")
  .onRun(async () => {
    const settingsSnap = await db.doc("config/settings").get();
    const usageSnap = await db.doc("config/usage").get();
    if (!settingsSnap.exists || !usageSnap.exists) return null;

    const settings = settingsSnap.data();
    const usage = usageSnap.data();
    const limitBytes = Math.max(1, (settings.usageLimitMB || 512) * 1024 * 1024);
    const used = usage.estBytes || 0;
    const percent = Math.min(100, Math.round((used / limitBytes) * 100));

    if (percent < 90 || usage.limitAlertSent || !settings.adminEmail) {
      return null;
    }

    await db.collection("mail").add({
      to: settings.adminEmail,
      message: {
        subject: `[Server watch · ${percent}%] ${settings.societyName} — Firestore storage near limit`,
        text:
          `Payments stored: ${usage.paymentsCount}\n` +
          `Estimated size: ${Math.round(used / 1048576)} MB of ${settings.usageLimitMB} MB.\n` +
          `Open Admin → Archive, download the Excel register + JSON backup, then purge.`,
      },
      createdAt: new Date().toISOString(),
    });
    await db.doc("config/usage").set({ limitAlertSent: true }, { merge: true });
    return null;
  });

// ── 2. SMTP sender: turns `mail` queue docs into real e-mail ─────────────────
exports.onMailCreate = functions.firestore
  .document("mail/{id}")
  .onCreate(async (snap) => {
    const appName = process.env.MAIL_FROM_NAME || "Society Khata";
    const fromEmail = process.env.MAIL_FROM || process.env.SMTP_USER;
    if (!fromEmail || !process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.warn("SMTP not configured — mail doc left in queue: ", snap.id);
      return null;
    }
    const data = snap.data();
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: `${appName} (no-reply) <${fromEmail}>`,
      to: data.to,
      subject: (data.message && data.message.subject) || "Society Khata",
      text: data.message && data.message.text,
      html: data.message && data.message.html,
    });
    // delivered — remove from queue to keep the collection tiny
    await snap.ref.delete();
    return null;
  });
