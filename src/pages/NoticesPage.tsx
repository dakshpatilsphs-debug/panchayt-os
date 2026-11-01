import { useEffect, useState } from "react";
import { IconBoard, IconPin } from "../components/Icons";
import { useToast } from "../components/Toast";
import { listNotices } from "../lib/store";
import type { Notice } from "../lib/types";

/** The society's notice board — committee bulletins, pinned ones on top. */
export default function NoticesPage() {
  const { toast } = useToast();
  const [notices, setNotices] = useState<Notice[] | null>(null);

  useEffect(() => {
    let alive = true;
    listNotices()
      .then((ns) => alive && setNotices(ns))
      .catch((e) => toast(e.message, "err"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pinned = (notices ?? []).filter((n) => n.pinned);
  const rest = (notices ?? []).filter((n) => !n.pinned);

  if (!notices) {
    return (
      <div className="loading-pad">
        <p className="muted">Reading the board…</p>
      </div>
    );
  }

  return (
    <div>
      <section className="hero">
        <p className="eyebrow">Society notice board</p>
        <h1>Bulletins from your committee.</h1>
        <p className="lede">Cleanings, water cuts, meetings, deadlines — everything the secretary pins up.</p>
      </section>

      {notices.length === 0 && (
        <div className="emptycard">
          <IconBoard size={30} />
          <h3>The board is empty</h3>
          <p className="muted">The committee will post notices here — nothing yet.</p>
        </div>
      )}

      <div className="notices-wrap">
        {[
          [pinned, "Pinned"],
          [rest, "Recent"],
        ].map(([list, label]) =>
          (list as Notice[]).length === 0 ? null : (
            <div key={label as string} className="notices-group">
              <p className="eyebrow">{label as string}</p>
              {(list as Notice[]).map((n) => (
                <article key={n.id} className={`notice-card nt-${n.tone} ${n.pinned ? "pinned" : ""}`}>
                  <header className="nhead">
                    <div className="ntitle">
                      {n.pinned && <span className="pinflag"><IconPin size={11} /> pinned</span>}
                      <h3>{n.title}</h3>
                    </div>
                    <span className="ndate">
                      {new Date(n.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </header>
                  <p className="nbody">{n.body}</p>
                </article>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
