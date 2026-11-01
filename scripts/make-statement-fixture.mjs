// Generates a tiny text-layer bank statement PDF (xref computed by hand).
import { writeFileSync } from "node:fs";

const lines = [
  ["SHANTI VILLA CO-OP HSG SOCIETY - STATEMENT", 12],
  ["Sr  Date        Description                    Ref     Credit    Balance", 10],
  ["1    21-01-2026  UPI/CR/405123456789/A-101      SBI9    2800.00   154000.00", 10],
  ["2    23-01-2026  NEFT CR SBI-88 SHANTI B-102    NEFT77  3199.50   157199.50", 10],
  ["3    24-01-2026  INTEREST PAID                  CASH1   500.00    157699.50", 10],
  ["4    25-01-2026  ATM WITHDRAWAL                 CASH2   2000.00   155699.50", 10],
];

const stream = lines
  .map(([text, size], i) => `BT /F1 ${size} Tf 40 ${770 - i * 22} Td (${String(text).replace(/([()\\])/g, " ")}) Tj ET`)
  .join("\n")
  .replace(/\s{2,}/g, (m) => m); // keep column gaps — pdf.js splits on x-gap anyway

const objs = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
];

let pdf = "%PDF-1.4\n";
const offsets = [];
objs.forEach((body, i) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

writeFileSync(new URL("./statement-fixture.pdf", import.meta.url), Buffer.from(pdf, "latin1"));
console.log("statement-fixture.pdf written");
