// Node driver: exercise matchStatement with the exact bank-credit shapes the
// readers produce — UTR hit, amount+date hit, near miss, and all-paid verdict.
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { matchStatement, readStatement } from "../node_modules/.tmp/statement-test.mjs";

const credit = (date, amount, utr, narrative, bankRef, where) => ({
  date: new Date(date), amount, narrative, bankRef, utr, where, matchedTo: null,
});

const credits = [
  credit("2026-01-21", 2800, "405123456789", "UPI/CR/405123456789/SHANTI A-101", "SBI9", "CSV row 2"),
  credit("2026-01-23", 3199.5, "", "NEFT CR SBI-88 SHANTI B-102", "NEFT-77", "CSV row 3"),
  credit("2026-01-24", 500, "", "INTEREST PAID", "CASH-1", "CSV row 4"),
];

const payments = [
  { id: "P1", amount: 2800, utr: "405123456789", createdAt: "2026-01-20T10:00:00Z", status: "verified" }, // excluded: not pending
  { id: "P2", amount: 3200, utr: "", createdAt: "2026-01-22T10:00:00Z", status: "pending" },              // 3200 vs 3199.50 = 0.50 off, +1 day -> amount+date
  { id: "P3", amount: 5000, utr: "", createdAt: "2026-01-25T10:00:00Z", status: "pending" },              // nothing close -> unmatched with reason
];

const cmp = matchStatement(credits, payments);

const checks = [
  ["credits read", cmp.credits === 3],
  ["checked = 2 pending", cmp.checked === 2],
  ["P2 matched amount+date", cmp.matched.some((m) => m.id === "P2" && m.via === "amount+date" && Math.abs(m.amount - 3200) < 0.01)],
  ["P1 not counted (not pending)", !cmp.matched.some((m) => m.id === "P1")],
  ["P3 unmatched with reason", cmp.unmatched.length === 1 && cmp.unmatched[0].id === "P3" && cmp.unmatched[0].reason.includes("date in window")],
  ["interest credit is stray", cmp.strays.length === 2], // 3199.50 claimed by P2, 2800... wait
  ["NOT all paid", cmp.allPaid === false],
];

// all-paid scenario: same P2+P3 receipts against a full-matching statement
const cmp2 = matchStatement(
  [
    credit("2026-01-23", 3200, "", "UPI CR SHANTI B-102", "SBI8", "CSV row 2"),
    credit("2026-01-25", 5000, "409999888777", "UPI/CR/409999888777/C-103", "SBI7", "CSV row 3"),
  ],
  [
    { id: "P2", amount: 3200, utr: "", createdAt: "2026-01-22T10:00:00Z", status: "pending" },
    { id: "P3", amount: 5000, utr: "409999888777", createdAt: "2026-01-25T10:00:00Z", status: "pending" },
  ]
);
checks.push(["scenario 2 allPaid", cmp2.allPaid === true && cmp2.unmatched.length === 0]);
checks.push(["scenario 2 P3 matched by UTR", cmp2.matched.some((m) => m.id === "P3" && m.via === "utr")]);

// CSV reader leg: real readStatement against a bank-CSV File (Node 20+ has File)
const csv = [
  "Sr,Date,Description,Ref,Credit,Balance",
  "1,21-01-2026,UPI/CR/405123456789/SHANTI A-101,SBI9,2800.00,154000.00",
  "2,23-01-2026,NEFT CR SBI-88 B-102,NEFT-77,3199.50,157199.50",
  "3,24-01-2026,INTEREST PAID,CASH-1,500.00,157699.50",
  "4,25-01-2026,ATM WITHDRAWAL,CASH-2,2000.00,155699.50",
].join("\n");
const readingCsv = await readStatement(new File([csv], "statement.csv", { type: "text/csv" }));
const creditsCsv = readingCsv.credits;
checks.push(["CSV reads 3 credits (debit row excluded)", creditsCsv.length === 3]);
checks.push(["CSV credit row 2", creditsCsv.some((c) => c.amount === 2800 && c.utr === "405123456789")]);

const cmp3 = matchStatement(creditsCsv, [
  { id: "P4", amount: 2800, utr: "405123456789", createdAt: "2026-01-20T10:00:00Z", status: "pending" },
]);
checks.push(["CSV-sourced UTR match", cmp3.allPaid === true && cmp3.matched[0]?.via === "utr"]);

// FAILED handling: entries the statement itself marks failed must become
// receipts marked failed — never "verified", never "need chasing"
const cmpFail = matchStatement([], [
  { id: "F1", amount: 2800, utr: "100000000000", createdAt: "2026-10-28T10:00:00Z", status: "pending" },
  { id: "F2", amount: 2500, utr: "", createdAt: "2026-10-22T10:00:00Z", status: "pending" },
], {
  failures: [
    credit("2026-10-29", 2800, "100000000000", "29-10-2026 100000000000 FAILED 2,800.00", "100000000000", "statement row 2"),
    credit("2026-10-25", 2500, "100147409174", "3 25-Oct-2026 FAILED 2,500.00 100147409174", "100147409174", "statement row 6"),
  ],
});
checks.push(["FAILED entry matches pending receipt by UTR", cmpFail.failed.some((f) => f.id === "F1" && f.via === "utr")]);
checks.push(["FAILED entry matches by amount+date", cmpFail.failed.some((f) => f.id === "F2" && f.via === "amount+date")]);
checks.push(["failed receipts are not 'unmatched'", cmpFail.unmatched.every((u) => u.id !== "F1" && u.id !== "F2")]);
checks.push(["no allPaid verdict while receipts are FAILED", cmpFail.allPaid === false]);
checks.push(["FAILED receipts are never 'matched'", cmpFail.matched.length === 0]);

// real-world layout leg (regression): wrapped/interleaved society statements.
// Uses the committee's own sample folder when it exists on this machine.
import { fileURLToPath } from "url";
const stmtDir = new URL("../bank statement/", import.meta.url);
if (existsSync(stmtDir)) {
  const sample = join(fileURLToPath(stmtDir), "Shanti_Villa_Collection_Statement.pdf");
  if (existsSync(sample)) {
    const buf = readFileSync(sample);
    const reading = await readStatement(new File([buf], "Shanti_Villa_Collection_Statement.pdf", { type: "application/pdf" }));
    checks.push(["wrapped society statement reads 23 credits", reading.credits.length === 23]);
    checks.push(["every credit carries its 12-digit UTR", reading.credits.every((c) => /^\d{12}$/.test(c.utr))]);
    checks.push(["first credit = 2800 with UTR 100140708757", reading.credits[0]?.amount === 2800 && reading.credits[0]?.utr === "100140708757"]);
  }
  const demo = join(fileURLToPath(stmtDir), "ShantiVillaCHSLtd-Demo-Payment-Statement.pdf");
  if (existsSync(demo)) {
    const reading = await readStatement(new File([readFileSync(demo)], "ShantiVillaCHSLtd-Demo-Payment-Statement.pdf", { type: "application/pdf" }));
    checks.push(["demo statement reads 20 paid credits (2 FAILED excluded)", reading.credits.length === 20]);
    checks.push(["demo statement surfaces exactly 2 FAILED entries", reading.failed.length === 2]);
  }
}

let fail = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "OK  " : "FAIL"}  ${name}`);
  if (!ok) fail++;
}
console.log(fail === 0 ? "STATEMENT MATCH SMOKE OK" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
