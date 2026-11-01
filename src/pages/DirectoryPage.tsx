import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { IconBuilding, IconLedger, IconPhone } from "../components/Icons";
import { useToast } from "../components/Toast";
import { listContacts, listMembers, loadSettings, setSessionId } from "../lib/store";
import type { Contact, Member, SocietySettings } from "../lib/types";
import { floorLabel, getFlatFloor } from "../lib/util";

export default function DirectoryPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<SocietySettings | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [tab, setTab] = useState<"flats" | "committee" | "contacts">("flats");
  const [wing, setWing] = useState<string>("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([loadSettings(), listMembers(), listContacts()])
      .then(([s, ms, cs]) => {
        if (!alive) return;
        setSettings(s);
        setMembers(ms);
        setContacts(cs);
        if (ms.length > 0 && !wing) {
          setWing(ms[0].wing);
        }
      })
      .catch((e) => toast((e as Error).message, "err"));
    return () => {
      alive = false;
    };
  }, []);

  const wings = useMemo(() => {
    const set = new Set<string>(settings?.wings ?? []);
    (members ?? []).forEach((m) => m.wing && set.add(m.wing));
    return Array.from(set).sort();
  }, [settings, members]);

  const activeWing = wing || wings[0] || "A";

  // Filter flats by wing & search query
  const filteredFlats = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (members ?? [])
      .filter((m) => m.wing === activeWing && m.active)
      .filter((m) => {
        if (!q) return true;
        const fl = String(getFlatFloor(m.flat, m.floor));
        return (
          m.flat.toLowerCase().includes(q) ||
          m.ownerName.toLowerCase().includes(q) ||
          m.phone.includes(q) ||
          fl === q ||
          floorLabel(getFlatFloor(m.flat, m.floor)).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const floorA = getFlatFloor(a.flat, a.floor);
        const floorB = getFlatFloor(b.flat, b.floor);
        if (floorA !== floorB) return floorA - floorB;
        return a.flat.localeCompare(b.flat, "en", { numeric: true });
      });
  }, [members, activeWing, query]);

  // Group flats by floor
  const floorGroups = useMemo(() => {
    const groups = new Map<number, Member[]>();
    for (const m of filteredFlats) {
      const f = getFlatFloor(m.flat, m.floor);
      if (!groups.has(f)) groups.set(f, []);
      groups.get(f)!.push(m);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }, [filteredFlats]);

  const committeeMembers = useMemo(
    () => (contacts ?? []).filter((c) => c.category === "committee"),
    [contacts]
  );

  const emergencyAndServices = useMemo(
    () => (contacts ?? []).filter((c) => c.category !== "committee"),
    [contacts]
  );

  const selectFlatForPayment = (m: Member) => {
    setSessionId(m.id);
  };

  if (!members || !settings || !contacts) {
    return (
      <div className="loading-pad">
        <p className="muted">Opening society directory…</p>
      </div>
    );
  }

  return (
    <div>
      <section className="hero">
        <p className="eyebrow">{settings.societyName}</p>
        <h1>Society Directory & Contacts</h1>
        <p className="lede">
          Floor-wise flat directory with registered resident names, elected committee management, and building emergency helplines.
        </p>
      </section>

      <div className="card pad" style={{ marginBottom: "24px" }}>
        <div className="chipsrow" style={{ borderBottom: "1px solid var(--line)", paddingBottom: "12px", marginBottom: "16px" }}>
          <button
            className={`chip ${tab === "flats" ? "chip-on" : ""}`}
            onClick={() => setTab("flats")}
            style={{ fontWeight: 600, fontSize: "14px" }}
          >
            🏢 Floor-wise Flats & Owners
          </button>
          <button
            className={`chip ${tab === "committee" ? "chip-on" : ""}`}
            onClick={() => setTab("committee")}
            style={{ fontWeight: 600, fontSize: "14px" }}
          >
            🏛️ Society Management ({committeeMembers.length})
          </button>
          <button
            className={`chip ${tab === "contacts" ? "chip-on" : ""}`}
            onClick={() => setTab("contacts")}
            style={{ fontWeight: 600, fontSize: "14px" }}
          >
            🚨 Emergency & Helplines ({emergencyAndServices.length})
          </button>
        </div>

        {/* ── Subtab 1: Floor-wise Flats & Owners (Read-only for residents) ── */}
        {tab === "flats" && (
          <div>
            <div className="filterrow" style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center", marginBottom: "20px" }}>
              <div>
                <span className="eyebrow">Wing</span>
                <div className="chipsrow">
                  {wings.map((w) => (
                    <button key={w} className={`chip ${activeWing === w ? "chip-on" : ""}`} onClick={() => setWing(w)}>
                      Wing {w}
                    </button>
                  ))}
                </div>
              </div>
              <label style={{ flex: 1, minWidth: "220px" }}>
                <span className="eyebrow">Search Flats & Owners</span>
                <input
                  className="input"
                  placeholder="Search flat (e.g. 201), floor, or owner name…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>

            {floorGroups.length === 0 ? (
              <div className="emptycard">
                <IconBuilding size={28} />
                <h3>No flats found</h3>
                <p className="muted">
                  {query ? "No flats match your search." : `Wing ${activeWing} has no flats configured yet.`}
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                {floorGroups.map(([floorNum, floorFlats]) => (
                  <div key={floorNum} style={{ background: "var(--bg-subtle, rgba(0,0,0,0.02))", border: "1px solid var(--line)", borderRadius: "12px", padding: "16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                      <h3 style={{ margin: 0, fontSize: "16px", color: "var(--fg)" }}>
                        {floorLabel(floorNum)}
                      </h3>
                      <span className="badge" style={{ fontSize: "12px" }}>
                        {floorFlats.length} {floorFlats.length === 1 ? "flat" : "flats"}
                      </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "12px" }}>
                      {floorFlats.map((m) => (
                        <div
                          key={m.id}
                          style={{
                            background: "var(--card-bg, #fff)",
                            border: "1px solid var(--line)",
                            borderRadius: "10px",
                            padding: "13px 15px",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                            gap: "10px",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                          }}
                        >
                          <div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                              <span style={{ fontSize: "18px", fontWeight: 700, color: "var(--fg)" }}>
                                {m.wing}-{m.flat}
                              </span>
                              <span className="muted" style={{ fontSize: "11px" }}>
                                {floorLabel(floorNum)}
                              </span>
                            </div>
                            <div style={{ marginTop: "6px" }}>
                              <div style={{ fontSize: "14px", fontWeight: 600, color: m.ownerName ? "var(--fg)" : "var(--muted)" }}>
                                {m.ownerName || "— Owner not listed"}
                              </div>
                              {m.phone && (
                                <a
                                  href={`tel:${m.phone}`}
                                  style={{ fontSize: "12px", color: "var(--brand, #0066cc)", textDecoration: "none", display: "block", marginTop: "3px" }}
                                >
                                  📞 {m.phone}
                                </a>
                              )}
                            </div>
                          </div>

                          <Link
                            to="/"
                            onClick={() => selectFlatForPayment(m)}
                            className="btn btn-outline btn-sm"
                            style={{ width: "100%", justifyContent: "center", marginTop: "4px" }}
                          >
                            <IconLedger size={13} /> Pay for {m.flat}
                          </Link>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Subtab 2: Society Management & Committee Members ── */}
        {tab === "committee" && (
          <div>
            <div style={{ marginBottom: "16px" }}>
              <h2 className="card-title">🏛️ Elected Society Committee & Management</h2>
              <p className="muted" style={{ fontSize: "13.5px", margin: "4px 0 0" }}>
                Contact office bearers for society permissions, certificates, parking allocations, and general governance.
              </p>
            </div>

            {committeeMembers.length === 0 ? (
              <div className="emptycard">
                <h3>No committee members listed</h3>
                <p className="muted">The society committee members can be added in the Admin Portal.</p>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "14px" }}>
                {committeeMembers.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      background: "var(--card-bg, #fff)",
                      border: "1px solid var(--line)",
                      borderTop: "3px solid var(--brand)",
                      borderRadius: "10px",
                      padding: "16px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: "12px",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.03)",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                        <span className="badge b-verified" style={{ fontWeight: 700, fontSize: "11px", letterSpacing: "0.05em" }}>
                          COMMITTEE
                        </span>
                        {c.notes && <span className="muted" style={{ fontSize: "11px" }}>{c.notes}</span>}
                      </div>
                      <div style={{ marginTop: "10px", fontSize: "17px", fontWeight: 700, color: "var(--fg)" }}>
                        {c.name}
                      </div>
                      <div style={{ color: "var(--brand-deep, #1d4d3b)", fontWeight: 600, fontSize: "13.5px", marginTop: "2px" }}>
                        {c.role}
                      </div>
                    </div>

                    <a
                      href={`tel:${c.phone}`}
                      className="btn btn-primary btn-sm"
                      style={{ textDecoration: "none", justifyContent: "center" }}
                    >
                      <IconPhone size={13} /> Call {c.phone}
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Subtab 3: Emergency & Utility Helplines ── */}
        {tab === "contacts" && (
          <div>
            <div style={{ marginBottom: "16px" }}>
              <h2 className="card-title">🚨 Emergency & Facility Helplines</h2>
              <p className="muted" style={{ fontSize: "13.5px", margin: "4px 0 0" }}>
                Emergency contacts for security gate, electricians, plumbers, lift breakdown, and public safety.
              </p>
            </div>

            {emergencyAndServices.length === 0 ? (
              <div className="emptycard">
                <h3>No emergency contacts listed</h3>
                <p className="muted">Emergency contacts can be added in the Admin Portal.</p>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "14px" }}>
                {emergencyAndServices.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      background: "var(--card-bg, #fff)",
                      border: "1px solid var(--line)",
                      borderTop: `3px solid ${c.category === "emergency" ? "var(--danger, #d32f2f)" : "var(--brand-mid, #2f7d4f)"}`,
                      borderRadius: "10px",
                      padding: "16px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: "10px",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.03)",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                        <span className={`badge b-${c.category === "emergency" ? "rejected" : "pending"}`}>
                          {c.category.toUpperCase()}
                        </span>
                        {c.notes && <span className="muted" style={{ fontSize: "11px" }}>{c.notes}</span>}
                      </div>
                      <div style={{ marginTop: "8px", fontSize: "16px", fontWeight: 700, color: "var(--fg)" }}>
                        {c.name}
                      </div>
                      <div className="muted" style={{ fontSize: "13px" }}>
                        {c.role}
                      </div>
                    </div>

                    <a
                      href={`tel:${c.phone}`}
                      className="btn btn-primary btn-sm"
                      style={{
                        textDecoration: "none",
                        justifyContent: "center",
                        backgroundColor: c.category === "emergency" ? "#dc2626" : undefined,
                      }}
                    >
                      <IconPhone size={13} /> Call {c.phone}
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
