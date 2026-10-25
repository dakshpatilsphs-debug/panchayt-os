/**
 * Node smoke test for the Excel register generator.
 * Verifies the workbook builds, opens, and holds the expected structure.
 * Run: node scripts/smoke-excel.mjs
 */
import { writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { buildRegisterWorkbook } from "../src/lib/excel.ts";
import { DEFAULT_SETTINGS, type Member, type Payment } from "../src/lib/types.ts";

const members: Member[] = [
  { id: "A-101", wing: "A", flat: "101", ownerName: "Anita Deshpande", phone: "9800111234", monthlyMaintenance: 2800, dueBalance: 2800, active: true },
  { id: "A-102", wing: "A", flat: "102", ownerName: "Rohan Iyer", phone: "9800445678", monthlyMaintenance: 2800, dueBalance: 0, active: true },
  { id: "B-201", wing: "B", flat: "201", ownerName: "Farhan Khan", phone: "9811220091", monthlyMaintenance: 3200, dueBalance: 6400, active: true },
  { id: "B-202", wing: "B", flat: "202", ownerName: "Meera Nair", phone: "9811776621", monthlyMaintenance: 3200, dueBalance: 0, active: true },
  { id: "C-101", wing: "C", flat: "101", ownerName: "Joseph Baptista", phone: "9822330022", monthlyMaintenance: 2500, dueBalance: 0, active: false },
];

const days = (n: number) => new Date(Date.now() - n * 864e5).toISOString();
const payments: Payment[] = [
  { id: "SK-202610-K7Q2", memberId: "A-102", wing: "A", flat: "102", ownerName: "Rohan Iyer", month: "2026-10", amount: 2800, maintenancePart: 2800, donationPart: 0, method: "upi", utr: "407126358890", status: "verified", createdAt: days(3), verifiedAt: days(2), note: "" },
  { id: "SK-202610-M2Z8", memberId: "B-202", wing: "B", flat: "202", ownerName: "Meera Nair", month: "2026-10", amount: 5200, maintenancePart: 3200, donationPart: 2000, method: "upi", utr: "311988227744", status: "pending", createdAt: days(1), note: "Including the Fiji community fund" },
  { id: "SK-202609-X4L1", memberId: "A-101", wing: "A", flat: "101", ownerName: "Anita Deshpande", month: "2026-09", amount: 1500, maintenancePart: 1500, donationPart: 0, method: "upi", utr: "520011774466", status: "verified", createdAt: days(34), verifiedAt: days(33) },
  { id: "SK-202609-P9R5", memberId: "C-101", wing: "C", flat: "101", ownerName: "Joseph Baptista", month: "2026-09", amount: 2500, maintenancePart: 2500, donationPart: 0, method: "upi", utr: "600122004411", status: "rejected", createdAt: days(40) },
];

const usage = { paymentsCount: payments.length, estBytes: 42000, limitAlertSent: false, lastChecked: days(0) };

const blob = await buildRegisterWorkbook(payments, members, DEFAULT_SETTINGS, usage, { scope: "all" });
const buf = Buffer.from(await blob.arrayBuffer());
const EXCEL_PATH = fileURLToPath(new URL("./register-smoke.xlsx", import.meta.url));
writeFileSync(EXCEL_PATH, buf);
console.log("wrote register-smoke.xlsx:", (statSync(EXCEL_PATH).size / 1024).toFixed(1), "KB");

// open + verify
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(EXCEL_PATH);
console.log("sheets:", wb.worksheets.map((w) => w.name).join(" | "));

const ws = wb.getWorksheet("Collection Register");
const header = ws.getRow(8).values;
console.log("header ok:", header[2] === "Receipt" && header[8] === "Amount" && header[15] === "Verified on");
console.log("society title:", ws.getCell(1, 6).value);
const rows = [];
for (let r = 9; r <= 12; r++) rows.push(ws.getRow(r).getCell(2).value);
console.log("receipts on sheet:", rows.join(", "));
const totalCell = ws.getRow(14).getCell(8).value;
console.log("grand total formula:", JSON.stringify(totalCell));

const ws2 = wb.getWorksheet("Wing Summary");
console.log("wing rows:", ws2.getRow(5).getCell(1).value, ws2.getRow(6).getCell(1).value, ws2.getRow(7).getCell(1).value, "| collected A:", ws2.getRow(5).getCell(4).result ?? ws2.getRow(5).getCell(4).value);
console.log("SMOKE OK");
