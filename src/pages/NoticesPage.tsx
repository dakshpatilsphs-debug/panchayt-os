import { useEffect, useMemo, useState } from "react";
import { IconBoard, IconPin } from "../components/Icons";
import { useToast } from "../components/Toast";
import { useSession } from "../lib/session";
import { listMembers, listNotices } from "../lib/store";
import type { Member, Notice } from "../lib/types";
import { floorLabel, getFlatFloor } from "../lib/util";

/** The society's notice board — floor-wise, flat-wise, and society-wide bulletins. */
export default function NoticesPage() {
  const { toast } = useToast();
  const sessionId = useSession();
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);

  // Filter state
  const [selectedFloor, setSelectedFloor] = useState<string>("all");
  const [selectedFlat, setSelectedFlat] = useState<string>("all");

  useEffect(() => {
    let alive = true;
    Promise.all([listNotices(), listMembers()])
      .then(([ns, ms]) => {
        if (!alive) return;
        setNotices(ns);
        setMembers(ms);
      })
      .catch((e) => toast(e.message, "err"));

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compute session member details if available
  const sessionMember = useMemo(
    () => members.find((m) => m.id === sessionId),
    [members, sessionId]
  );
  const sessionFloor = sessionMember ? getFlatFloor(sessionMember.flat, sessionMember.floor) : null;

  // Available unique floors
  const availableFloors = useMemo(() => {
    const set = new Set<number>();
    members.forEach((m) => set.add(getFlatFloor(m.flat, m.floor)));
    (notices ?? []).forEach((n) => {
      if (n.targetType === "floor" && typeof n.targetFloor === "number") {
        set.add(n.targetFloor);
      }
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [members, notices]);

  // Filter notices based on floor and flat filter
  const filteredNotices = useMemo(() => {
    if (!notices) return [];
    return notices.filter((n) => {
      const type = n.targetType ?? "all";

      // If flat filter is active
      if (selectedFlat !== "all") {
        if (type === "all") return true;
        if (type === "flat") return n.targetFlat?.toUpperCase() === selectedFlat.toUpperCase();
        if (type === "floor") {
          const flatMember = members.find((m) => m.flat.toUpperCase() === selectedFlat.toUpperCase());
          const targetF = flatMember ? getFlatFloor(flatMember.flat, flatMember.floor) : getFlatFloor(selectedFlat);
          return n.targetFloor === targetF;
        }
        if (type === "wing") {
          const flatMember = members.find((m) => m.flat.toUpperCase() === selectedFlat.toUpperCase());
          return flatMember?.wing?.toUpperCase() === n.targetWing?.toUpperCase();
        }
        return true;
      }

      // If floor filter is active
      if (selectedFloor !== "all") {
        const floorNum = Number(selectedFloor);
        if (type === "all") return true;
        if (type === "floor") return n.targetFloor === floorNum;
        if (type === "flat" && n.targetFlat) {
          const flatMember = members.find((m) => m.flat.toUpperCase() === n.targetFlat?.toUpperCase());
          const flatF = flatMember ? getFlatFloor(flatMember.flat, flatMember.floor) : getFlatFloor(n.targetFlat);
          return flatF === floorNum;
        }
        return false;
      }

      return true;
    });
  }, [notices, selectedFloor, selectedFlat, members]);

  const pinned = filteredNotices.filter((n) => n.pinned);
  const rest = filteredNotices.filter((n) => !n.pinned);

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
        <h1>Bulletins & floor-wise notices.</h1>
        <p className="lede">Cleanings, water cuts, floor maintenance, and society announcements.</p>
      </section>

      {/* Filter Toolbar */}
      <div
        className="card pad"
        style={{
          marginBottom: 24,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          justifyContent: "space-between",
          background: "var(--card)",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <span className="eyebrow" style={{ marginRight: 4 }}>Filter:</span>
          <button
            type="button"
            className={`chip ${selectedFloor === "all" && selectedFlat === "all" ? "chip-on" : ""}`}
            onClick={() => {
              setSelectedFloor("all");
              setSelectedFlat("all");
            }}
          >
            All Bulletins ({notices.length})
          </button>

          {sessionMember && (
            <button
              type="button"
              className={`chip ${selectedFlat === sessionMember.flat ? "chip-on" : ""}`}
              onClick={() => {
                setSelectedFloor("all");
                setSelectedFlat(sessionMember.flat);
              }}
            >
              My Flat ({sessionMember.wing ? `${sessionMember.wing}-` : ""}{sessionMember.flat})
            </button>
          )}

          {sessionFloor !== null && (
            <button
              type="button"
              className={`chip ${selectedFloor === String(sessionFloor) && selectedFlat === "all" ? "chip-on" : ""}`}
              onClick={() => {
                setSelectedFlat("all");
                setSelectedFloor(String(sessionFloor));
              }}
            >
              My Floor ({floorLabel(sessionFloor)})
            </button>
          )}
        </div>

        {/* Dropdowns for granular filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <span className="muted">Floor:</span>
            <select
              className="input"
              style={{ padding: "4px 8px", fontSize: 13, height: 32 }}
              value={selectedFloor}
              onChange={(e) => {
                setSelectedFloor(e.target.value);
                setSelectedFlat("all");
              }}
            >
              <option value="all">All floors</option>
              {availableFloors.map((f) => (
                <option key={f} value={f}>
                  {floorLabel(f)}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <span className="muted">Flat:</span>
            <select
              className="input"
              style={{ padding: "4px 8px", fontSize: 13, height: 32, maxWidth: 160 }}
              value={selectedFlat}
              onChange={(e) => {
                setSelectedFlat(e.target.value);
                setSelectedFloor("all");
              }}
            >
              <option value="all">All flats</option>
              {members.map((m) => (
                <option key={m.id} value={m.flat}>
                  {m.wing ? `${m.wing}-${m.flat}` : m.flat} {m.ownerName ? `(${m.ownerName})` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {filteredNotices.length === 0 && (
        <div className="emptycard">
          <IconBoard size={30} />
          <h3>No notices match this filter</h3>
          <p className="muted">
            {selectedFloor !== "all" || selectedFlat !== "all"
              ? "No notices currently targeted to this selection. Showing society-wide notices when available."
              : "The committee will post notices here — nothing yet."}
          </p>
          {(selectedFloor !== "all" || selectedFlat !== "all") && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 12 }}
              onClick={() => {
                setSelectedFloor("all");
                setSelectedFlat("all");
              }}
            >
              View all notices
            </button>
          )}
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
                      {n.targetType === "floor" && (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 6,
                            background: "rgba(3, 105, 161, 0.12)",
                            color: "#0369a1",
                            fontWeight: 600,
                          }}
                        >
                          🏢 {floorLabel(n.targetFloor ?? 1)}
                        </span>
                      )}
                      {n.targetType === "flat" && (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 6,
                            background: "rgba(126, 34, 206, 0.12)",
                            color: "#7e22ce",
                            fontWeight: 600,
                          }}
                        >
                          🚪 Flat {n.targetFlat}
                        </span>
                      )}
                      {n.targetType === "wing" && (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 6,
                            background: "rgba(180, 83, 9, 0.12)",
                            color: "#b45309",
                            fontWeight: 600,
                          }}
                        >
                          🏛️ Wing {n.targetWing}
                        </span>
                      )}
                      {(!n.targetType || n.targetType === "all") && (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 6,
                            background: "var(--brand-soft)",
                            color: "var(--brand-deep)",
                            fontWeight: 600,
                          }}
                        >
                          🌐 Society-wide
                        </span>
                      )}
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
