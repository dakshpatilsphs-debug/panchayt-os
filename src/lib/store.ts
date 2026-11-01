import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  increment,
  limit as fsLimit,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type UpdateData,
} from "firebase/firestore";
import { fdb, isDemo } from "./firebase";
import { notifySession } from "./session";
import { DEFAULT_SETTINGS, type Member, type Notice, type Payment, type SocietySettings, type Usage } from "./types";
import { byteLen, newPaymentId, memberId as mkId } from "./util";

/* ────────────────────────── demo storage (localStorage) ────────────────────────── */

const K = {
  settings: "sk.settings",
  members: "sk.members",
  payments: "sk.payments",
  usage: "sk.usage",
  mail: "sk.sentmail",
  notices: "sk.notices",
};

/** The remembered flat (memberId) — quiet browser memory, no account behind it. */
const SESSION_KEY = "sk.session";

function rd<T>(key: string, fb: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fb;
  } catch {
    return fb;
  }
}

function wr(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

let seeded = false;

/** One-time demo seeding so every screen has meaningful data to show. */
function seedDemo(): void {
  if (seeded) return;
  seeded = true;
  if (localStorage.getItem(K.settings)) return;

  wr(K.settings, DEFAULT_SETTINGS);

  const first = ["Anita", "Rohan", "Sunita", "Vikram", "Farhan", "Meera", "Joseph", "Lakshmi"];
  const last = ["Deshpande", "Iyer", "Khan", "Baptista", "Nair", "Shah", "Kaur", "Reddy"];
  const members: Member[] = [];
  let n = 0;
  for (const w of DEFAULT_SETTINGS.wings) {
    for (let f = 1; f <= 6; f++) {
      const monthly = [2800, 3200, 2500][n % 3];
      const flat = `${f}0${(n % 3) + 1}`;
      members.push({
        id: mkId(w, flat),
        wing: w,
        flat,
        ownerName: `${first[n % 8]} ${last[(n + 3) % 8]}`,
        phone: `9${String(800000000 + n * 1234577).slice(0, 9)}`,
        monthlyMaintenance: monthly,
        dueBalance: n % 4 === 0 ? monthly : 0,
        active: true,
      });
      n++;
    }
  }
  wr(K.members, members);

  const payments: Payment[] = [];
  const now = new Date();
  for (let i = 0; i < 26; i++) {
    const m = members[(i * 5) % members.length];
    if (m.dueBalance > 0 && i % 3 !== 0) continue;
    const daysAgo = 3 + ((i * 7) % 75);
    const d = new Date(now.getTime() - daysAgo * 864e5);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const maintenancePart = m.dueBalance > 0 ? m.dueBalance : m.monthlyMaintenance;
    const status: Payment["status"] = i % 11 === 0 ? "pending" : i % 17 === 0 ? "rejected" : "verified";
    const id = `${newPaymentId()}${String(i).padStart(2, "0")}`;
    payments.push({
      id,
      memberId: m.id,
      wing: m.wing,
      flat: m.flat,
      ownerName: m.ownerName,
      month,
      amount: maintenancePart,
      maintenancePart,
      donationPart: 0,
      method: "upi",
      utr: String(1e11 + ((i * 6700417) % 9e11)),
      status,
      createdAt: d.toISOString(),
      verifiedAt: status !== "pending" ? new Date(d.getTime() + 36e5).toISOString() : undefined,
      dueSettled: status === "verified",
      note: "",
    });
  }
  wr(K.payments, payments);
    wr(K.usage, {
    paymentsCount: payments.length,
    estBytes: payments.reduce((a, p) => a + byteLen(p), 0),
    limitAlertSent: false,
    lastChecked: new Date().toISOString(),
  });

  // A starter notice board so the login screen has something to show
  const notices: Notice[] = [
    {
      id: "NT-01",
      title: "Diwali deep-cleaning of the premises",
      body: "Wing-wise schedule is up on the physical board. Please move vehicles between 6–9 a.m. on your cleaning day. Sweeper fund: ₹150 per flat, collected at the gate on the 2nd November.",
      tone: "event",
      createdAt: new Date(Date.now() - 2 * 864e5).toISOString(),
      pinned: true,
    },
    {
      id: "NT-02",
      title: "Maintenance for October–November",
      body: "Kindly pay before the 10th. Receipts marked pending are verified by the treasurer within a day; attaching your UPI screenshot makes it faster. Interest on arrears resumes after the grace period.",
      tone: "info",
      createdAt: new Date(Date.now() - 5 * 864e5).toISOString(),
    },
    {
      id: "NT-03",
      title: "Water tank cleaning — Sunday 7 a.m.",
      body: "Supply will stay off for two hours while the overhead tanks are scrubbed and flushed. Store a bucket or two beforehand.",
      tone: "warn",
      createdAt: new Date(Date.now() - 8 * 864e5).toISOString(),
    },
  ];
  wr(K.notices, notices);
}

/** Deeply removes undefined fields from an object or array to prevent Firestore crashes. */
function stripUndefined<T>(val: T): T {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) {
    return val.map((x) => stripUndefined(x)) as unknown as T;
  }
  if (typeof val === "object" && (val as object).constructor === Object) {
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        r[k] = stripUndefined(v);
      }
    }
    return r as T;
  }
  return val;
}

/* ────────────────────────── settings ────────────────────────── */

export async function loadSettings(): Promise<SocietySettings> {
  if (isDemo) {
    seedDemo();
    return rd<SocietySettings>(K.settings, DEFAULT_SETTINGS);
  }
  const snap = await getDoc(doc(fdb(), "config", "settings"));
  if (!snap.exists()) {
    // first run on a fresh project — write the defaults so Packets admin can edit them later
    await setDoc(doc(fdb(), "config", "settings"), DEFAULT_SETTINGS, { merge: true });
    return DEFAULT_SETTINGS;
  }
  return { ...DEFAULT_SETTINGS, ...(snap.data() as Partial<SocietySettings>) };
}

export async function saveSettings(s: SocietySettings): Promise<void> {
  const withStamp = { ...s, updatedAt: new Date().toISOString() };
  if (isDemo) {
    wr(K.settings, withStamp);
    return;
  }
  await setDoc(doc(fdb(), "config", "settings"), withStamp, { merge: true });
}

/* ────────────────────────── members ────────────────────────── */

export async function listMembers(): Promise<Member[]> {
  if (isDemo) {
    seedDemo();
    return rd<Member[]>(K.members, []);
  }
  const snap = await getDocs(collection(fdb(), "members"));
  return snap.docs.map((d) => d.data() as Member).filter((m) => m && m.id && m.wing);
}

export async function saveMember(m: Member): Promise<void> {
  if (isDemo) {
    const arr = rd<Member[]>(K.members, []);
    const i = arr.findIndex((x) => x.id === m.id);
    if (i >= 0) arr[i] = m;
    else arr.push(m);
    wr(K.members, arr);
    return;
  }
  await setDoc(doc(fdb(), "members", m.id), m);
}

export async function deleteMember(id: string): Promise<void> {
  if (isDemo) {
    wr(K.members, rd<Member[]>(K.members, []).filter((m) => m.id !== id));
  } else {
    await deleteDoc(doc(fdb(), "members", id));
  }
}

/** Settles dues once the committee verifies a payment. */
export async function reduceMemberDue(memberId: string, by: number): Promise<void> {
  if (by <= 0) return;
  if (isDemo) {
    const arr = rd<Member[]>(K.members, []);
    const i = arr.findIndex((m) => m.id === memberId);
    if (i >= 0) {
      arr[i] = { ...arr[i], dueBalance: Math.max(0, arr[i].dueBalance - by) };
      wr(K.members, arr);
    }
    return;
  }
  const ref = doc(fdb(), "members", memberId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const m = snap.data() as Member;
  await setDoc(ref, { ...m, dueBalance: Math.max(0, (m.dueBalance || 0) - by) });
}

/* ────────────────────────── payments ────────────────────────── */

export async function listPayments(): Promise<Payment[]> {
  if (isDemo) {
    seedDemo();
    return rd<Payment[]>(K.payments, []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const snap = await getDocs(collection(fdb(), "payments"));
  return snap.docs.map((d) => d.data() as Payment).filter((p) => p && p.id);
}

export async function getPayment(id: string): Promise<Payment | null> {
  if (isDemo) {
    return rd<Payment[]>(K.payments, []).find((p) => p.id === id) ?? null;
  }
  const snap = await getDoc(doc(fdb(), "payments", id));
  return snap.exists() ? (snap.data() as Payment) : null;
}

/**
 * One pending draft per flat per month — the anti-duplicate anchor.
 * Double clicks, refreshes and flaky networks all land on the SAME draft
 * instead of minting a second receipt. Rejected drafts don't match, so a
 * refused payment can be retried cleanly.
 */
export async function findPendingDraft(memberId: string, month: string): Promise<Payment | null> {
  if (isDemo) {
    return (
      rd<Payment[]>(K.payments, [])
        .find((p) => p.memberId === memberId && p.month === month && p.status === "pending")
        ?? null
    );
  }
  const snap = await getDocs(
    query(
      collection(fdb(), "payments"),
      where("memberId", "==", memberId),
      where("month", "==", month),
      where("status", "==", "pending"),
      fsLimit(1)
    )
  );
  return snap.empty ? null : (snap.docs[0].data() as Payment);
}

export async function createPayment(p: Payment): Promise<Payment> {
  const clean = stripUndefined(p);
  const bytes = byteLen(clean);
  if (isDemo) {
    const arr = rd<Payment[]>(K.payments, []);
    arr.unshift(clean);
    wr(K.payments, arr);
    wr(K.usage, {
      paymentsCount: arr.length,
      estBytes: arr.reduce((a, x) => a + byteLen(x), 0),
      limitAlertSent: rd<Usage>(K.usage, { limitAlertSent: false } as Usage).limitAlertSent,
      lastChecked: new Date().toISOString(),
    });
    return clean;
  }
  await setDoc(doc(fdb(), "payments", clean.id), clean);
  await setDoc(
    doc(fdb(), "config", "usage"),
    { paymentsCount: increment(1), estBytes: increment(bytes), lastChecked: new Date().toISOString() },
    { merge: true }
  );
  return clean;
}

export async function updatePayment(id: string, patch: Partial<Payment>): Promise<void> {
  const clean = stripUndefined(patch as Record<string, unknown>) as Partial<Payment>;
  if (isDemo) {
    const arr = rd<Payment[]>(K.payments, []);
    const i = arr.findIndex((p) => p.id === id);
    if (i >= 0) {
      const updated = { ...arr[i] };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) {
          delete (updated as Record<string, unknown>)[k];
        } else {
          (updated as Record<string, unknown>)[k] = stripUndefined(v);
        }
      }
      arr[i] = updated as Payment;
    }
    wr(K.payments, arr);
    // screenshots dance the byte tally — keep the estimate honest
    if ("screenshot" in patch) {
      wr(K.usage, {
        paymentsCount: arr.length,
        estBytes: arr.reduce((a, x) => a + byteLen(x), 0),
        limitAlertSent: rd<Usage>(K.usage, { limitAlertSent: false } as Usage).limitAlertSent,
        lastChecked: new Date().toISOString(),
      });
    }
    return;
  }
  const ref = doc(fdb(), "payments", id);
  const fsUpdate: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) {
      fsUpdate[k] = deleteField();
    } else {
      fsUpdate[k] = stripUndefined(v);
    }
  }
  try {
    await updateDoc(ref, fsUpdate as UpdateData<DocumentData>);
  } catch {
    await setDoc(ref, fsUpdate, { merge: true });
  }
  if ("screenshot" in patch) {
    const delta = (typeof clean.screenshot === "string" ? clean.screenshot.length : 0) - (await oldScreenshotLen(id));
    if (delta !== 0) {
      await setDoc(
        doc(fdb(), "config", "usage"),
        { estBytes: increment(delta), lastChecked: new Date().toISOString() },
        { merge: true }
      );
    }
  }
}

async function oldScreenshotLen(id: string): Promise<number> {
  try {
    const snap = await getDoc(doc(fdb(), "payments", id));
    const prev = snap.exists() ? (snap.data() as Payment).screenshot : undefined;
    return typeof prev === "string" ? prev.length : 0;
  } catch {
    return 0;
  }
}

export async function deletePayment(id: string): Promise<void> {
  if (isDemo) {
    wr(K.payments, rd<Payment[]>(K.payments, []).filter((p) => p.id !== id));
  } else {
    await deleteDoc(doc(fdb(), "payments", id));
  }
}

/* ────────────────────────── usage & limits ────────────────────────── */

const EMPTY_USAGE: Usage = { paymentsCount: 0, estBytes: 0, limitAlertSent: false, lastChecked: "" };

export async function loadUsage(): Promise<Usage> {
  if (isDemo) {
    seedDemo();
    return { ...EMPTY_USAGE, ...rd<Usage>(K.usage, EMPTY_USAGE) };
  }
  const snap = await getDoc(doc(fdb(), "config", "usage"));
  return snap.exists() ? { ...EMPTY_USAGE, ...(snap.data() as Usage) } : EMPTY_USAGE;
}

/** Re-measures the payments collection (count × average document size). */
export async function recountUsage(): Promise<Usage> {
  const now = new Date().toISOString();
  if (isDemo) {
    const payments = rd<Payment[]>(K.payments, []);
    const prev = rd<Usage>(K.usage, EMPTY_USAGE);
    const u: Usage = {
      paymentsCount: payments.length,
      estBytes: payments.reduce((a, p) => a + byteLen(p), 0),
      limitAlertSent: prev.limitAlertSent,
      lastChecked: now,
    };
    wr(K.usage, u);
    return u;
  }
  const col = collection(fdb(), "payments");
  const count = await getCountFromServer(col);
  const sample = await getDocs(query(col, fsLimit(5)));
  const avg = sample.empty ? 0 : sample.docs.reduce((a, d) => a + byteLen(d.data()), 0) / sample.docs.length;
  const prev = await getDoc(doc(fdb(), "config", "usage"));
  const u: Usage = {
    paymentsCount: count.data().count,
    estBytes: Math.round(count.data().count * avg),
    limitAlertSent: prev.exists() ? Boolean((prev.data() as Usage).limitAlertSent) : false,
    lastChecked: now,
  };
  await setDoc(doc(fdb(), "config", "usage"), u, { merge: true });
  return u;
}

export async function setAlertSent(v: boolean): Promise<void> {
  if (isDemo) {
    wr(K.usage, { ...EMPTY_USAGE, ...rd<Usage>(K.usage, EMPTY_USAGE), limitAlertSent: v, lastChecked: new Date().toISOString() });
  } else {
    await setDoc(doc(fdb(), "config", "usage"), { limitAlertSent: v, lastChecked: new Date().toISOString() }, { merge: true });
  }
}

/**
 * Deletes every document in `payments` (batched, 400 at a time) and resets the
 * usage counter. Called only after the archive has been saved to the admin's PC.
 */
export async function purgePayments(): Promise<number> {
  if (isDemo) {
    wr(K.payments, []);
    wr(K.usage, { ...EMPTY_USAGE, lastChecked: new Date().toISOString() });
    return 0;
  }
  const col = collection(fdb(), "payments");
  let deleted = 0;
  for (;;) {
    const snap = await getDocs(query(col, fsLimit(400)));
    if (snap.empty) break;
    const batch = writeBatch(fdb());
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
  }
  await setDoc(doc(fdb(), "config", "usage"), { ...EMPTY_USAGE, lastChecked: new Date().toISOString() }, { merge: true });
  return deleted;
}

/* ────────────────────────── mail (no-reply) ────────────────────────── */

/**
 * Writes to the `mail` collection. The Firebase "Trigger Email" extension
 * (auth/firestore-send-email) picks these up and delivers them from your
 * project's no-reply sender. Requires zero server code on your side.
 */
export async function sendMailDoc(
  to: string,
  subject: string,
  html: string,
  text: string
): Promise<"queued" | "stored" | "skipped"> {
  if (!to) return "skipped";
  if (isDemo) {
    const log = rd<{ to: string; subject: string; at: string }[]>(K.mail, []);
    log.unshift({ to, subject, at: new Date().toISOString() });
    wr(K.mail, log.slice(0, 20));
    return "stored";
  }
  await addDoc(collection(fdb(), "mail"), {
    to,
    message: { subject, html, text },
    createdAt: new Date().toISOString(),
  });
  return "queued";
}

export async function lastMails(): Promise<{ to: string; subject: string; at: string }[]> {
  if (isDemo) return rd(K.mail, []);
  try {
    const snap = await getDocs(query(collection(fdb(), "mail"), fsLimit(5)));
    return snap.docs
      .map((d) => {
        const v = d.data() as { to?: string; message?: { subject?: string }; createdAt?: string };
        return { to: v.to ?? "—", subject: v.message?.subject ?? "(no subject)", at: v.createdAt ?? "" };
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  } catch {
    return [];
  }
}

/* ────────────────────────── quiet flat memory ────────────────────────── */

/**
 * NO resident accounts and NO PINs — paying is open: pick your wing + flat and
 * go. The picked flat id is remembered in this browser purely so "My payments"
 * opens on it next time. Option-clear it any time.
 */
export function setSessionId(id: string): void {
  try {
    localStorage.setItem(SESSION_KEY, id);
  } catch {
    /* private mode: memory simply won't survive a reload */
  }
  notifySession();
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  notifySession();
}

/* ────────────────────────── notice board ────────────────────────── */

export async function listNotices(): Promise<Notice[]> {
  if (isDemo) {
    seedDemo();
    return rd<Notice[]>(K.notices, []).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
  }
  const snap = await getDocs(collection(fdb(), "notices"));
  return snap.docs
    .map((d) => d.data() as Notice)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
}

export async function saveNotice(n: Notice): Promise<void> {
  const withStamp = { ...n, updatedAt: new Date().toISOString() };
  if (isDemo) {
    const arr = rd<Notice[]>(K.notices, []);
    const i = arr.findIndex((x) => x.id === n.id);
    if (i >= 0) arr[i] = withStamp;
    else arr.unshift(withStamp);
    wr(K.notices, arr);
    return;
  }
  await setDoc(doc(fdb(), "notices", n.id), withStamp, { merge: true });
}

export async function deleteNotice(id: string): Promise<void> {
  if (isDemo) {
    wr(K.notices, rd<Notice[]>(K.notices, []).filter((n) => n.id !== id));
    return;
  }
  await deleteDoc(doc(fdb(), "notices", id));
}

export function newNoticeId(): string {
  return `NT-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}
