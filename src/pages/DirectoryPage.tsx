import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../components/Toast";
import { listContacts, listMembers, loadSettings } from "../lib/store";
import type { Contact, Member, SocietySettings } from "../lib/types";
import { floorLabel, getFlatFloor } from "../lib/util";

export default function DirectoryPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<SocietySettings | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [activeTab, setActiveTab] = useState<"flats" | "committee" | "staff" | "emergency">("flats");
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
      .catch((e) => toast(e.message, "err"));
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text);
    toast("Phone number copied to clipboard.", "info");
  };

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

  const staffMembers = useMemo(
    () => (contacts ?? []).filter((c) => c.category === "staff" || c.category === "services"),
    [contacts]
  );

  const emergencyContacts = useMemo(
    () => (contacts ?? []).filter((c) => c.category === "emergency"),
    [contacts]
  );

  if (!members || !settings || !contacts) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-12 h-12 rounded-full bg-gold-soft flex items-center justify-center text-primary mb-4 animate-spin">
          <span className="material-symbols-outlined text-[28px]">sync</span>
        </div>
        <p className="text-ink-soft text-body-sm font-medium">Opening society directory&hellip;</p>
      </div>
    );
  }

  return (
    <div className="relative w-full max-w-[1280px] mx-auto px-gutter py-8 pb-16">
      {/* Editorial Header Section */}
      <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-line/60">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-block w-2 h-2 rounded-full bg-primary"></span>
            <span className="font-label-sm text-label-sm text-primary uppercase tracking-widest font-semibold">
              Verified Society Index &bull; FY 2026-27
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">
            Society Contact Directory
          </h1>
          <p className="font-body-lg text-body-lg text-ink-soft mt-1.5">
            Connect with committee trustees, estate maintenance teams, and 24/7 emergency helplines with single-touch verification.
          </p>
        </div>

        {/* Quick Trust Stats */}
        <div className="flex items-center gap-4 bg-surface px-5 py-3 rounded-2xl shadow-sm border border-line">
          <div className="flex flex-col">
            <span className="font-label-sm text-label-sm text-muted uppercase">Active Desk</span>
            <span className="font-title-md text-title-md text-success flex items-center gap-1.5 mt-0.5">
              <span className="w-2 h-2 rounded-full bg-success animate-ping"></span> 100% On-Duty
            </span>
          </div>
          <div className="w-px h-8 bg-line"></div>
          <div className="flex flex-col">
            <span className="font-label-sm text-label-sm text-muted uppercase">Units Registered</span>
            <span className="font-code-md text-title-md text-on-surface font-semibold mt-0.5">
              {members.length} Flats
            </span>
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="relative z-10 bg-surface rounded-2xl p-3 shadow-sm border border-line my-6">
        <div className="flex flex-col lg:flex-row items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1 w-full">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-muted">
              search
            </span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, flat number (e.g. 201), floor, or role..."
              className="w-full bg-surface-container-low pl-12 pr-4 py-3 rounded-xl font-body-md text-body-md text-on-surface placeholder:text-muted focus:outline-none focus:bg-surface border border-transparent focus:border-line transition-all"
            />
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1.5 w-full lg:w-auto overflow-x-auto pb-1 lg:pb-0 scrollbar-none">
            <button
              type="button"
              onClick={() => setActiveTab("flats")}
              className={`shrink-0 px-4 py-2.5 rounded-xl font-label-md text-label-md transition-all cursor-pointer ${
                activeTab === "flats"
                  ? "bg-primary text-on-primary font-semibold shadow-sm"
                  : "bg-surface-container-low text-ink-soft hover:bg-gold-soft hover:text-primary"
              }`}
            >
              Floor-wise Flats ({members.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("committee")}
              className={`shrink-0 px-4 py-2.5 rounded-xl font-label-md text-label-md transition-all cursor-pointer ${
                activeTab === "committee"
                  ? "bg-primary text-on-primary font-semibold shadow-sm"
                  : "bg-surface-container-low text-ink-soft hover:bg-gold-soft hover:text-primary"
              }`}
            >
              Managing Committee ({committeeMembers.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("staff")}
              className={`shrink-0 px-4 py-2.5 rounded-xl font-label-md text-label-md transition-all cursor-pointer ${
                activeTab === "staff"
                  ? "bg-primary text-on-primary font-semibold shadow-sm"
                  : "bg-surface-container-low text-ink-soft hover:bg-gold-soft hover:text-primary"
              }`}
            >
              Estate Staff ({staffMembers.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("emergency")}
              className={`shrink-0 px-4 py-2.5 rounded-xl font-label-md text-label-md transition-all cursor-pointer ${
                activeTab === "emergency"
                  ? "bg-primary text-on-primary font-semibold shadow-sm"
                  : "bg-surface-container-low text-ink-soft hover:bg-gold-soft hover:text-primary"
              }`}
            >
              Emergency SOS ({emergencyContacts.length})
            </button>
          </div>
        </div>
      </div>

      {/* TAB 1: Floor-wise Flats & Owners */}
      {activeTab === "flats" && (
        <section className="flex flex-col gap-6">
          {/* Wing Selector Row */}
          <div className="flex items-center gap-2 bg-surface p-3 rounded-2xl border border-line shadow-sm">
            <span className="font-label-sm text-ink-soft uppercase font-semibold px-2">Select Wing:</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {wings.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWing(w)}
                  className={`px-4 py-1.5 rounded-full font-label-md text-label-md transition-all cursor-pointer ${
                    activeWing === w
                      ? "bg-primary text-on-primary font-semibold shadow-sm"
                      : "bg-surface-container-low text-on-surface hover:bg-gold-soft"
                  }`}
                >
                  Wing {w}
                </button>
              ))}
            </div>
          </div>

          {floorGroups.length === 0 ? (
            <div className="bg-surface rounded-2xl p-12 text-center border border-line shadow-sm">
              <span className="material-symbols-outlined text-[48px] text-muted mb-2">apartment</span>
              <h3 className="font-title-lg text-title-lg text-on-surface">No units match your query</h3>
              <p className="font-body-sm text-muted mt-1">Try searching for a different flat or owner name.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {floorGroups.map(([floorNum, fList]) => (
                <div key={floorNum} className="bg-surface rounded-2xl p-5 border border-line shadow-sm">
                  <div className="flex items-center justify-between pb-3 border-b border-line/60 mb-4">
                    <h3 className="font-title-lg text-title-lg text-on-surface font-semibold flex items-center gap-2">
                      <span className="material-symbols-outlined text-[20px] text-primary">layers</span>
                      {floorLabel(floorNum)}
                    </h3>
                    <span className="px-2.5 py-0.5 rounded-full bg-gold-soft text-primary font-code-md text-[11px] font-bold">
                      {fList.length} {fList.length === 1 ? "Unit" : "Units"}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
                    {fList.map((m) => (
                      <div
                        key={m.id}
                        className="p-4 rounded-xl bg-surface-soft hover:bg-gold-soft/30 transition-all border border-line/60 flex flex-col justify-between gap-3 group"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="font-code-md text-title-md font-bold text-on-surface">
                              {m.wing}-{m.flat}
                            </span>
                            <span className="font-label-sm text-[11px] text-muted block">
                              {floorLabel(floorNum)}
                            </span>
                          </div>
                          <span
                            className={`w-2.5 h-2.5 rounded-full mt-1 ${
                              m.dueBalance > 0 ? "bg-warning" : "bg-success"
                            }`}
                            title={m.dueBalance > 0 ? `₹${m.dueBalance} due` : "Account clear"}
                          />
                        </div>

                        <div>
                          <span className="font-body-sm font-semibold text-on-surface block truncate">
                            {m.ownerName || "— Owner not specified"}
                          </span>
                          {m.phone ? (
                            <a
                              href={`tel:${m.phone}`}
                              className="font-code-md text-[12px] text-primary hover:underline flex items-center gap-1 mt-0.5"
                            >
                              <span className="material-symbols-outlined text-[14px]">call</span>
                              {m.phone}
                            </a>
                          ) : (
                            <span className="font-code-md text-[11px] text-muted">No phone recorded</span>
                          )}
                        </div>

                        <Link
                          to={`/?wing=${encodeURIComponent(m.wing)}&flat=${encodeURIComponent(m.flat)}`}
                          className="w-full py-2 px-3 rounded-lg bg-surface hover:bg-primary hover:text-on-primary text-primary font-label-md text-[12px] font-semibold border border-line transition-all flex items-center justify-center gap-1.5 shadow-sm text-center"
                        >
                          <span className="material-symbols-outlined text-[14px]">qr_code_scanner</span>
                          <span>Pay for Unit {m.flat}</span>
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 2: Managing Committee */}
      {activeTab === "committee" && (
        <section className="flex flex-col gap-6 animate-fadeIn">
          {/* Banner */}
          <div className="relative overflow-hidden rounded-2xl bg-surface-soft p-6 lg:p-8 shadow-sm border border-line flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="max-w-xl">
              <span className="px-3 py-1 rounded-full bg-gold-soft text-gold-deep font-label-sm text-label-sm uppercase font-semibold">
                Elected Governing Body
              </span>
              <h2 className="font-headline-md text-headline-md text-on-surface mt-2">
                Executive Council of Trustees
              </h2>
              <p className="font-body-md text-body-md text-ink-soft mt-1">
                Available for resident resolutions, flat transfers, NOC requests, and structural escalations during administrative visiting hours.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {committeeMembers.map((c) => (
              <div
                key={c.id}
                className="bg-surface rounded-2xl p-6 shadow-sm border border-line flex flex-col justify-between hover:-translate-y-1 transition-all duration-300 relative"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-12 h-12 rounded-full bg-gold-soft text-primary font-bold text-title-md flex items-center justify-center shadow-sm">
                      {c.name.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-gold-soft text-primary font-label-sm text-label-sm font-semibold uppercase">
                      {c.role}
                    </span>
                  </div>

                  <h3 className="font-headline-sm text-headline-sm text-on-surface">{c.name}</h3>
                  <p className="font-body-sm text-body-sm text-muted mt-0.5">{c.notes || "Society Executive Trustee"}</p>

                  <div className="mt-4 pt-3 flex flex-col gap-2 bg-surface-container-low p-3 rounded-xl border border-line/60">
                    <div className="flex items-center justify-between">
                      <span className="font-label-sm text-label-sm text-muted uppercase">Phone</span>
                      <span className="font-code-md text-code-md text-on-surface font-semibold">{c.phone}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex items-center gap-2">
                  <a
                    href={`tel:${c.phone}`}
                    className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-gold-deep text-on-primary py-2.5 rounded-xl font-label-md text-label-md transition-all shadow-sm"
                  >
                    <span className="material-symbols-outlined text-[18px]">call</span>
                    <span>Call Now</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(c.phone)}
                    className="p-2.5 rounded-xl bg-surface-container-low hover:bg-gold-soft text-ink-soft hover:text-primary transition-all border border-line/60 cursor-pointer"
                    title="Copy Number"
                  >
                    <span className="material-symbols-outlined text-[18px]">content_copy</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* TAB 3: Estate Operations & Staff */}
      {activeTab === "staff" && (
        <section className="flex flex-col gap-6 animate-fadeIn">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {staffMembers.map((c) => (
              <div
                key={c.id}
                className="bg-surface rounded-2xl p-6 shadow-sm border border-line flex flex-col justify-between hover:-translate-y-1 transition-all"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="px-2.5 py-0.5 rounded-full bg-surface-container-low text-ink-soft font-label-sm text-label-sm uppercase font-semibold">
                      {c.category.toUpperCase()}
                    </span>
                    <span className="font-label-sm text-success flex items-center gap-1 font-semibold">
                      <span className="w-2 h-2 rounded-full bg-success"></span> On Duty
                    </span>
                  </div>

                  <h3 className="font-headline-sm text-headline-sm text-on-surface">{c.name}</h3>
                  <p className="font-body-sm text-body-sm text-primary font-medium mt-0.5">{c.role}</p>
                  {c.notes && <p className="font-body-sm text-[12px] text-muted mt-2">{c.notes}</p>}
                </div>

                <div className="mt-6 flex items-center gap-2">
                  <a
                    href={`tel:${c.phone}`}
                    className="flex-1 flex items-center justify-center gap-2 bg-primary hover:bg-gold-deep text-on-primary py-2.5 rounded-xl font-label-md text-label-md transition-all shadow-sm"
                  >
                    <span className="material-symbols-outlined text-[18px]">call</span>
                    <span>Call {c.phone}</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(c.phone)}
                    className="p-2.5 rounded-xl bg-surface-container-low hover:bg-gold-soft text-ink-soft hover:text-primary transition-all border border-line/60 cursor-pointer"
                    title="Copy Number"
                  >
                    <span className="material-symbols-outlined text-[18px]">content_copy</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* TAB 4: Emergency SOS */}
      {activeTab === "emergency" && (
        <section className="flex flex-col gap-6 animate-fadeIn">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {emergencyContacts.map((c) => (
              <div
                key={c.id}
                className="bg-error-container/30 border border-error-container rounded-2xl p-6 shadow-sm flex flex-col justify-between hover:-translate-y-1 transition-all"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="px-2.5 py-0.5 rounded-full bg-error text-white font-label-sm text-label-sm uppercase font-bold tracking-wider">
                      EMERGENCY 24/7
                    </span>
                    <span className="material-symbols-outlined text-error text-[24px]">emergency</span>
                  </div>
                  <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">{c.name}</h3>
                  <p className="font-body-sm text-body-sm text-error font-semibold mt-0.5">{c.role}</p>
                  {c.notes && <p className="font-body-sm text-[12px] text-ink-soft mt-2">{c.notes}</p>}
                </div>

                <div className="mt-6 flex items-center gap-2">
                  <a
                    href={`tel:${c.phone}`}
                    className="flex-1 flex items-center justify-center gap-2 bg-error hover:bg-red-700 text-white py-3 rounded-xl font-label-md text-label-md font-bold transition-all shadow-md"
                  >
                    <span className="material-symbols-outlined text-[20px]">call</span>
                    <span>Emergency Dial: {c.phone}</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(c.phone)}
                    className="p-3 rounded-xl bg-surface hover:bg-surface-soft text-error transition-all border border-line shadow-sm cursor-pointer"
                    title="Copy SOS Number"
                  >
                    <span className="material-symbols-outlined text-[18px]">content_copy</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
