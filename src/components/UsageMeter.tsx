import { bytesHuman } from "../lib/util";

export default function UsageMeter({
  usedBytes,
  limitMB,
  count,
}: {
  usedBytes: number;
  limitMB: number;
  count?: number;
}) {
  const limitBytes = Math.max(1, limitMB) * 1024 * 1024;
  const pct = Math.min(100, (usedBytes / limitBytes) * 100);
  const tone = pct >= 90 ? "danger" : pct >= 70 ? "warn" : "ok";

  return (
    <div className={`gauge gauge-${tone}`}>
      <div className="gauge-top">
        <span className="eyebrow">Firestore — payments collection</span>
        <span className="gauge-pct">{Math.round(pct)}%</span>
      </div>
      <div className="gauge-bar">
        <span style={{ width: `${Math.max(pct, 1.5)}%` }} />
      </div>
      <div className="gauge-meta">
        <span>
          <b>{bytesHuman(usedBytes)}</b> of {limitMB} MB soft limit
          {typeof count === "number" ? ` · ${count.toLocaleString("en-IN")} payment records` : ""}
        </span>
        <span>An e-mail alert fires automatically at 90%.</span>
      </div>
    </div>
  );
}
