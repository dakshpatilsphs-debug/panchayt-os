import type { Member, Payment, SocietySettings, Usage } from "./types";
import { bytesHuman, downloadBlob, fmtDateTime, monthLabel, slug } from "./util";

const BRAND = "FF1D4D3B";
const BRAND_DEEP = "FF0F3024";
const BRASS = "FFB08D3E";
const LINE = "FFE4DDCB";
const ZEBRA = "FFFAF7F0";
const INK = "FF1B2A23";
const MUTED = "FF71806F";

const INR_FMT = '"₹"#,##,##0.00';

const HEADERS = [
  "No",
  "Receipt",
  "Paid on",
  "Wing",
  "Flat",
  "Member",
  "Month",
  "Amount",
  "Maintenance",
  "Contribution",
  "Mode",
  "UPI ref / UTR",
  "Status",
  "Remarks",
  "Verified on",
  "Screenshot proof",
] as const;

const WIDTHS = [6, 16, 12, 7, 8, 26, 14, 13, 13, 13, 9, 20, 12, 24, 16, 18];

export interface RegisterMeta {
  /** e.g. "2026-10" or "all months" */
  scope: string;
  filterNote?: string;
}

export async function buildRegisterWorkbook(
  payments: Payment[],
  members: Member[],
  settings: SocietySettings,
  usage: Usage | null,
  meta: RegisterMeta
): Promise<Blob> {
  // ExcelJS is a ~1 MB library — keep it out of the critical path and
  // load it only when someone actually exports.
  const { Workbook } = await import("exceljs/dist/exceljs.min.js");
  const wb = new Workbook();
  wb.creator = settings.societyName;
  wb.created = new Date();

  const ws = wb.addWorksheet("Collection Register", {
    views: [{ state: "frozen", ySplit: HEAD_ROW }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.2, footer: 0.2 },
    },
  });
  ws.columns = WIDTHS.map((w) => ({ width: w }));

  let logoId: number | null = null;
  try {
    const res = await fetch("/logo.png");
    if (res.ok) logoId = wb.addImage({ buffer: new Uint8Array(await res.arrayBuffer()), extension: "png" });
  } catch {
    /* logo is decorative; keep the register working without it */
  }
  if (logoId !== null) {
    ws.addImage(logoId, { tl: { col: 0.15, row: 0.2 }, ext: { width: 78, height: 78 }, editAs: "oneCell" });
  }

  // ── letterhead ──────────────────────────────────────────────────────────
  ws.mergeCells(1, 6, 1, 15);
  ws.mergeCells(2, 6, 2, 15);
  ws.mergeCells(3, 6, 3, 15);
  ws.mergeCells(4, 6, 4, 10);
  ws.mergeCells(4, 11, 4, 15);
  ws.mergeCells(5, 6, 5, 15);

  const name = ws.getCell(1, 6);
  name.value = settings.societyName;
  name.font = { name: "Georgia", size: 20, bold: true, color: { argb: BRAND } };
  name.alignment = { vertical: "middle" };

  const addr = ws.getCell(2, 6);
  addr.value = `${settings.address1} · ${settings.address2}`;
  addr.font = { name: "Calibri", size: 10.5, color: { argb: INK } };

  const reg = ws.getCell(3, 6);
  reg.value = `Society Reg. No. ${settings.regNo}   ·   UPI: ${settings.upiId}`;
  reg.font = { name: "Calibri", size: 10.5, color: { argb: MUTED } };

  const period = ws.getCell(4, 11);
  period.value = `Period: ${meta.scope === "all" ? "All months" : monthLabel(meta.scope)}`;
  period.font = { name: "Calibri", size: 10.5, bold: true, color: { argb: BRASS } };
  period.alignment = { horizontal: "right", vertical: "middle" };

  const stamp = ws.getCell(5, 6);
  stamp.value = `MAINTENANCE COLLECTION REGISTER  ·  generated ${fmtDateTime(new Date().toISOString())}  ·  ${payments.length} record${payments.length === 1 ? "" : "s"}${
    meta.filterNote ? `  ·  ${meta.filterNote}` : ""
  }`;
  stamp.font = { name: "Calibri", size: 9.5, italic: true, color: { argb: MUTED } };

  for (let r = 1; r <= 7; r++) {
    const row = ws.getRow(r);
    row.height = r <= 5 ? 18 : 6;
  }

  // ── table header ────────────────────────────────────────────────────────
  const head = ws.getRow(HEAD_ROW);
  head.height = 22;
  HEADERS.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
    c.alignment = { vertical: "middle", horizontal: i === 0 || (i >= 6 && i <= 10) ? "center" : "left" };
    c.border = border("thin", "FF2A5C48");
  });

  // ── data rows ───────────────────────────────────────────────────────────
  payments
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .forEach((p, idx) => {
      const r = HEAD_ROW + 1 + idx;
      const row = ws.getRow(r);
      const zebra = idx % 2 === 1;

      // ── write the row cell-by-cell ──
      const set = (
        col: number,
        value: unknown,
        align: "left" | "center" | "right" = "left",
        numFmt?: string,
        opts?: { bold?: boolean; color?: string; fill?: string; wrap?: boolean }
      ) => {
        const c = row.getCell(col);
        c.value = value as never;
        c.alignment = { horizontal: align, vertical: "middle", wrapText: opts?.wrap };
        c.font = {
          name: "Calibri",
          size: (value as object) instanceof Date ? 10 : 10.5,
          bold: opts?.bold,
          color: { argb: opts?.color ?? INK },
        };
        if (numFmt) c.numFmt = numFmt;
        if (opts?.fill || zebra) {
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts?.fill ?? ZEBRA } };
        }
        c.border = border("thin", LINE);
      };

      set(1, idx + 1, "center", undefined, { color: MUTED });
      set(2, p.id, "left", undefined, { bold: true, color: BRAND_DEEP });
      set(3, new Date(p.createdAt), "center", "dd-mmm-yy");
      set(4, p.wing, "center");
      set(5, p.flat, "center");
      set(6, p.ownerName);
      set(7, monthLabel(p.month), "center");
      set(8, p.amount, "right", INR_FMT, { bold: true });
      set(9, p.maintenancePart, "right", INR_FMT);
      set(10, p.donationPart, "right", INR_FMT);
      set(11, "UPI · QR", "center");
      set(12, p.utr || "—", "center", undefined, { color: p.utr ? INK : MUTED });

      const tone =
        p.status === "verified"
          ? { fill: "FFE4F0E5", text: "FF2F7D4F", label: "Verified" }
          : p.status === "pending"
            ? { fill: "FFF8F0DC", text: "FF9A7B23", label: "Pending" }
            : { fill: "FFF6E3E0", text: "FFA93B32", label: "Rejected" };
      set(13, tone.label, "center", undefined, { fill: tone.fill, color: tone.text, bold: true });
      set(14, p.note || "", "left", undefined, { wrap: true, color: p.note ? INK : MUTED });
      set(15, p.verifiedAt ? new Date(p.verifiedAt) : "—", "center", p.verifiedAt ? "dd-mmm-yy hh:mm" : undefined);
      const proof = p.screenshot
        ? p.screenshotMeta?.verdict === "matched"
          ? `Attached · reader matched${p.screenshotMeta.ocrUtr ? ` (UTR ${p.screenshotMeta.ocrUtr})` : ""}`
          : p.screenshotMeta?.verdict === "partial"
            ? "Attached · reader flagged differences"
            : "Attached · not machine-readable"
        : "";
      set(16, proof, "left", undefined, { color: proof ? INK : MUTED });

      row.height = zebra ? 18 : 17;
    });

  // ── totals ──────────────────────────────────────────────────────────────
  const last = HEAD_ROW + payments.length;
  const totalRow = ws.getRow(last + 2);
  ws.mergeCells(last + 2, 1, last + 2, 7);
  const lbl = totalRow.getCell(1);
  lbl.value = `TOTAL  —  ${payments.length} payment${payments.length === 1 ? "" : "s"}, ${new Set(payments.map((p) => p.memberId)).size} flat${payments.length === 1 ? "" : "s"}`;
  lbl.font = { name: "Georgia", size: 11.5, bold: true, color: { argb: BRAND_DEEP } };
  lbl.alignment = { horizontal: "right", vertical: "middle" };

  ["H", "I", "J"].forEach((colL, i) => {
    const c = totalRow.getCell(8 + i);
    c.value = { formula: `SUM(${colL}${HEAD_ROW + 1}:${colL}${last})` };
    c.numFmt = INR_FMT;
    c.font = { name: "Calibri", size: 11, bold: true, color: { argb: BRAND_DEEP } };
    c.alignment = { horizontal: "right", vertical: "middle" };
  });

  for (let colIdx = 1; colIdx <= HEADERS.length; colIdx++) {
    const c = totalRow.getCell(colIdx);
    c.border = { ...border("thin", LINE), top: border("double", BRAND).top, bottom: border("double", BRAND).bottom };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1EDE2" } };
  }
  lbl.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
  totalRow.height = 22;

  // ── wing summary sheet ──────────────────────────────────────────────────
  const ws2 = wb.addWorksheet("Wing Summary");
  ws2.columns = [
    { width: 10 },
    { width: 12 },
    { width: 12 },
    { width: 18 },
    { width: 17 },
    { width: 17 },
    { width: 18 },
  ];

  ws2.mergeCells("A1:G1");
  const t1 = ws2.getCell("A1");
  t1.value = `${settings.societyName} — wing-wise summary`;
  t1.font = { name: "Georgia", size: 15, bold: true, color: { argb: BRAND } };
  t1.alignment = { vertical: "middle" };
  ws2.getRow(1).height = 30;

  ws2.mergeCells("A2:G2");
  const t2 = ws2.getCell("A2");
  t2.value =
    meta.scope === "all"
      ? `All recorded months · generated ${fmtDateTime(new Date().toISOString())}`
      : `${monthLabel(meta.scope)} · generated ${fmtDateTime(new Date().toISOString())}`;
  t2.font = { name: "Calibri", size: 10, italic: true, color: { argb: MUTED } };

  const sumHead = ws2.getRow(4);
  ["Wing", "Flats", "Payments", "Collected", "Maintenance", "Contribution", "Outstanding dues"].forEach((h, i) => {
    const c = sumHead.getCell(i + 1);
    c.value = h;
    c.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
    c.alignment = { horizontal: i <= 2 ? "center" : "right", vertical: "middle" };
    c.border = border("thin", "FF2A5C48");
  });
  sumHead.height = 20;

  const wings = Array.from(new Set(members.map((m) => m.wing))).sort();
  const sumRowStart = 5;
  wings.forEach((wing, i) => {
    const wMembers = members.filter((m) => m.wing === wing);
    const wPayments = payments.filter((p) => p.wing === wing);
    const row = ws2.getRow(sumRowStart + i);
    const vals: Array<[number, unknown, "center" | "right", string?]> = [
      [1, wing, "center"],
      [2, wMembers.filter((m) => m.active).length, "center"],
      [3, wPayments.length, "center"],
      [4, wPayments.reduce((a, p) => a + p.amount, 0), "right", INR_FMT],
      [5, wPayments.reduce((a, p) => a + p.maintenancePart, 0), "right", INR_FMT],
      [6, wPayments.reduce((a, p) => a + p.donationPart, 0), "right", INR_FMT],
      [7, wMembers.reduce((a, m) => a + (m.active ? m.dueBalance : 0), 0), "right", INR_FMT],
    ];
    vals.forEach(([col, v, align, fmt]) => {
      const c = row.getCell(col);
      c.value = v as never;
      c.alignment = { horizontal: align, vertical: "middle" };
      c.font = { name: "Calibri", size: 10.5 };
      if (fmt) c.numFmt = fmt;
      if (i % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      c.border = border("thin", LINE);
    });
    row.height = 18;
  });

  const sumTotal = ws2.getRow(sumRowStart + wings.length + 1);
  const sumLbl = sumTotal.getCell(1);
  sumLbl.value = "TOTAL";
  sumLbl.font = { name: "Calibri", size: 11, bold: true, color: { argb: BRAND_DEEP } };
  [3, 4, 5, 6, 7].forEach((col, i) => {
    const letter = ["C", "D", "E", "F", "G"][i];
    const c = sumTotal.getCell(col);
    c.value = { formula: `SUM(${letter}${sumRowStart}:${letter}${sumRowStart + wings.length - 1})` };
    if (col !== 3) c.numFmt = INR_FMT;
    c.font = { name: "Calibri", size: 11, bold: true, color: { argb: BRAND_DEEP } };
    c.alignment = { horizontal: col === 3 ? "center" : "right", vertical: "middle" };
  });
  for (let colIdx = 1; colIdx <= 7; colIdx++) {
    const c = sumTotal.getCell(colIdx);
    c.border = {
      ...border("thin", LINE),
      top: border("double", BRAND).top,
      bottom: border("double", BRAND).bottom,
    };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1EDE2" } };
  }
  sumTotal.height = 20;

  // info block — provenance for the archive
  const infoTop = sumRowStart + wings.length + 3;
  ws2.mergeCells(infoTop, 1, infoTop, 7);
  const ih = ws2.getCell(infoTop, 1);
  ih.value = "About this archive";
  ih.font = { name: "Georgia", size: 12, bold: true, color: { argb: BRAND } };

  const info: [string, string][] = [
    ["Registered name", settings.societyName],
    ["Registration no.", settings.regNo],
    ["Address", `${settings.address1}, ${settings.address2}`],
    ["UPI ID", settings.upiId],
    ["Records in file", `${payments.length} payments`],
    ["Firestore usage", usage ? `${usage.paymentsCount} docs · ~${bytesHuman(usage.estBytes)}` : "—"],
    ["Generated at", fmtDateTime(new Date().toISOString())],
    ["Scope", meta.scope === "all" ? "All months" : monthLabel(meta.scope)],
  ];
  info.forEach(([k, v], i) => {
    const row = ws2.getRow(infoTop + 1 + i);
    row.getCell(1).value = k;
    row.getCell(1).font = { name: "Calibri", size: 10.5, color: { argb: MUTED } };
    ws2.mergeCells(infoTop + 1 + i, 2, infoTop + 1 + i, 5);
    const vc = row.getCell(2);
    vc.value = v;
    vc.font = { name: "Calibri", size: 10.5, color: { argb: INK } };
  });

  ws2.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4, column: 7 },
  };

  // ── serialize ───────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export async function exportRegister(
  payments: Payment[],
  members: Member[],
  settings: SocietySettings,
  usage: Usage | null,
  meta: RegisterMeta
): Promise<void> {
  const blob = await buildRegisterWorkbook(payments, members, settings, usage, meta);
  const name = `${slug(settings.societyName)}-Collection-${
    meta.scope === "all" ? "AllMonths" : meta.scope
  }-${new Date().toISOString().slice(0, 10)}.xlsx`;
  downloadBlob(blob, name);
}

export function backupJson(
  settings: SocietySettings,
  members: Member[],
  payments: Payment[],
  usage: Usage | null
): void {
  const payload = {
    format: "society-khata/full-backup",
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    society: settings,
    usage,
    members,
    payments,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${slug(settings.societyName)}-khata-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

const HEAD_ROW = 8;

function border(style: "thin" | "double", color: string) {
  return { top: { style, color: { argb: color } }, left: { style, color: { argb: color } }, bottom: { style, color: { argb: color } }, right: { style, color: { argb: color } } };
}
