import { useEffect, useMemo, useState } from "react";
import { IconBuilding, IconCheck, IconEdit, IconPhone, IconPlus, IconTrash, IconUsers } from "../../components/Icons";
import { useToast } from "../../components/Toast";
import type { Contact, Member } from "../../lib/types";
import {
  deleteContact,
  deleteMember,
  listContacts,
  listMembers,
  newContactId,
  saveContact,
  saveMember,
  saveMembersBatch,
} from "../../lib/store";
import { floorLabel, generateFlatsList, getFlatFloor, inr, memberId } from "../../lib/util";
import { useAdmin } from "./AdminCtx";

interface Draft {
  ownerName: string;
  phone: string;
  monthlyMaintenance: string;
  dueBalance: string;
}

const toDraft = (m: Member): Draft => ({
  ownerName: m.ownerName,
  phone: m.phone,
  monthlyMaintenance: String(m.monthlyMaintenance),
  dueBalance: String(m.dueBalance),
});

type ActiveTab = "directory" | "management" | "emergency";

export default function MembersTab() {
  const { settings } = useAdmin();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<ActiveTab>("directory");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [wing, setWing] = useState("");
  const [search, setSearch] = useState("");

  // Individual flat add form
  const [newMember, setNewMember] = useState({ flat: "", phone: "", monthlyMaintenance: "", dueBalance: "0" });
  const [adding, setAdding] = useState(false);

  // Auto-generator state
  const [showGenerator, setShowGenerator] = useState(false);
  const [genFloors, setGenFloors] = useState("4");
  const [genFlatsPerFloor, setGenFlatsPerFloor] = useState("4");
  const [genStartFloor, setGenStartFloor] = useState("1");
  const [genMaintenance, setGenMaintenance] = useState("0");
  const [generating, setGenerating] = useState(false);

  // Committee management form state
  const [commName, setCommName] = useState("");
  const [commRole, setCommRole] = useState("Secretary");
  const [commPhone, setCommPhone] = useState("");
  const [commNotes, setCommNotes] = useState("");
  const [editingCommId, setEditingCommId] = useState<string | null>(null);
  const [savingComm, setSavingComm] = useState(false);

  // Emergency & utility contact form state
  const [emergName, setEmergName] = useState("");
  const [emergRole, setEmergRole] = useState("");
  const [emergPhone, setEmergPhone] = useState("");
  const [emergCategory, setEmergCategory] = useState<Contact["category"]>("services");
  const [emergNotes, setEmergNotes] = useState("");
  const [editingEmergId, setEditingEmergId] = useState<string | null>(null);
  const [savingEmerg, setSavingEmerg] = useState(false);

  useEffect(() => {
    Promise.all([listMembers(), listContacts()])
      .then(([ms, cs]) => {
        setMembers(ms);
        setContacts(cs);
        if (ms.length > 0 && !wing) setWing(ms[0].wing);
      })
      .catch((e) => toast((e as Error).message, "err"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wings = useMemo(() => {
    const set = new Set<string>(settings.wings);
    (members ?? []).forEach((m) => m.wing && set.add(m.wing));
    return Array.from(set).sort();
  }, [settings.wings, members]);

  const activeWing = wing || wings[0] || "A";

  const list = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.wing === activeWing)
        .filter((m) => {
          if (!search.trim()) return true;
          const q = search.trim().toLowerCase();
          return (
            m.flat.toLowerCase().includes(q) ||
            m.ownerName.toLowerCase().includes(q) ||
            m.phone.includes(q)
          );
        })
        .sort((a, b) => {
          const fa = getFlatFloor(a.flat, a.floor);
          const fb = getFlatFloor(b.flat, b.floor);
          if (fa !== fb) return fa - fb;
          return a.flat.localeCompare(b.flat, "en", { numeric: true });
        }),
    [members, activeWing, search]
  );

  // Group flats floor-wise
  const floorGroups = useMemo(() => {
    const map = new Map<number, Member[]>();
    for (const m of list) {
      const f = getFlatFloor(m.flat, m.floor);
      if (!map.has(f)) map.set(f, []);
      map.get(f)!.push(m);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [list]);

  const committeeMembers = useMemo(
    () => (contacts ?? []).filter((c) => c.category === "committee"),
    [contacts]
  );

  const emergencyContacts = useMemo(
    () => (contacts ?? []).filter((c) => c.category !== "committee"),
    [contacts]
  );

  const upsertLocal = (m: Member) => setMembers((ms) => [...(ms ?? []).filter((x) => x.id !== m.id), m]);

  // Handle single flat add
  const addMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const flatTrim = newMember.flat.trim();
    if (!flatTrim) {
      toast("Flat number is required.", "err");
      return;
    }
    const cleanWing = activeWing.trim().toUpperCase() || "A";
    const id = memberId(cleanWing, flatTrim);
    if ((members ?? []).some((m) => m.id === id)) {
      toast(`Flat ${id} already exists in the register.`, "err");
      return;
    }

    setAdding(true);
    try {
      const computedFloor = getFlatFloor(flatTrim);
      const m: Member = {
        id,
        wing: cleanWing,
        flat: flatTrim,
        floor: computedFloor,
        ownerName: "",
        phone: newMember.phone.trim(),
        monthlyMaintenance: Math.max(0, Number(newMember.monthlyMaintenance) || 0),
        dueBalance: Math.max(0, Number(newMember.dueBalance) || 0),
        active: true,
      };
      await saveMember(m);
      upsertLocal(m);
      setNewMember({ flat: "", phone: "", monthlyMaintenance: "", dueBalance: "0" });
      toast(`Flat ${m.wing}-${m.flat} added to Floor ${computedFloor}. You can now set the owner name.`, "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setAdding(false);
    }
  };

  // Handle Auto-generate flats
  const handleAutoGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    const floorsCount = parseInt(genFloors, 10);
    const flatsCount = parseInt(genFlatsPerFloor, 10);
    const startFloor = parseInt(genStartFloor, 10);
    const maintenanceAmt = Math.max(0, Number(genMaintenance) || 0);

    if (isNaN(floorsCount) || floorsCount < 1 || floorsCount > 50) {
      toast("Please enter a valid number of floors (1-50).", "err");
      return;
    }
    if (isNaN(flatsCount) || flatsCount < 1 || flatsCount > 20) {
      toast("Please enter a valid number of flats per floor (1-20).", "err");
      return;
    }

    setGenerating(true);
    try {
      const generated = generateFlatsList({
        wing: activeWing,
        totalFloors: floorsCount,
        flatsPerFloor: flatsCount,
        startFloor: isNaN(startFloor) ? 1 : startFloor,
        defaultMaintenance: maintenanceAmt,
      });

      const existingIds = new Set((members ?? []).map((m) => m.id));
      const toAdd: Member[] = [];

      for (const g of generated) {
        if (!existingIds.has(g.id)) {
          toAdd.push({
            id: g.id,
            wing: g.wing,
            flat: g.flat,
            floor: g.floor,
            ownerName: "",
            phone: "",
            monthlyMaintenance: g.monthlyMaintenance,
            dueBalance: 0,
            active: true,
          });
        }
      }

      if (toAdd.length === 0) {
        toast(`All generated flats already exist in Wing ${activeWing}.`, "info");
        setShowGenerator(false);
        setGenerating(false);
        return;
      }

      await saveMembersBatch(toAdd);
      const updated = await listMembers();
      setMembers(updated);
      setShowGenerator(false);
      toast(`Successfully created ${toAdd.length} flats across ${floorsCount} floors in Wing ${activeWing}!`, "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setGenerating(false);
    }
  };

  // ── Committee Member save/edit ──
  const handleSaveCommittee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commName.trim() || !commPhone.trim()) {
      toast("Name and phone number are required.", "err");
      return;
    }
    setSavingComm(true);
    try {
      const c: Contact = {
        id: editingCommId ?? newContactId(),
        name: commName.trim(),
        role: commRole.trim() || "Committee Member",
        phone: commPhone.trim(),
        category: "committee",
        notes: commNotes.trim(),
      };
      await saveContact(c);
      setContacts(await listContacts());
      setCommName("");
      setCommRole("Secretary");
      setCommPhone("");
      setCommNotes("");
      setEditingCommId(null);
      toast(editingCommId ? `Committee member "${c.name}" updated.` : `Added "${c.name}" to Society Management.`, "ok");
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setSavingComm(false);
    }
  };

  const startEditCommittee = (c: Contact) => {
    setEditingCommId(c.id);
    setCommName(c.name);
    setCommRole(c.role);
    setCommPhone(c.phone);
    setCommNotes(c.notes || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEditCommittee = () => {
    setEditingCommId(null);
    setCommName("");
    setCommRole("Secretary");
    setCommPhone("");
    setCommNotes("");
  };

  // ── Emergency & Utility contact save/edit ──
  const handleSaveEmergency = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emergName.trim() || !emergPhone.trim()) {
      toast("Name and phone number are required.", "err");
      return;
    }
    setSavingEmerg(true);
    try {
      const c: Contact = {
        id: editingEmergId ?? newContactId(),
        name: emergName.trim(),
        role: emergRole.trim() || "Emergency / Utility",
        phone: emergPhone.trim(),
        category: emergCategory,
        notes: emergNotes.trim(),
      };
      await saveContact(c);
      setContacts(await listContacts());
      setEmergName("");
      setEmergRole("");
      setEmergPhone("");
      setEmergCategory("services");
      setEmergNotes("");
      setEditingEmergId(null);
      toast(editingEmergId ? `Contact "${c.name}" updated.` : `Added contact "${c.name}".`, "ok");
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setSavingEmerg(false);
    }
  };

  const startEditEmergency = (c: Contact) => {
    setEditingEmergId(c.id);
    setEmergName(c.name);
    setEmergRole(c.role);
    setEmergPhone(c.phone);
    setEmergCategory(c.category);
    setEmergNotes(c.notes || "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEditEmergency = () => {
    setEditingEmergId(null);
    setEmergName("");
    setEmergRole("");
    setEmergPhone("");
    setEmergCategory("services");
    setEmergNotes("");
  };

  const removeContact = async (c: Contact) => {
    if (!window.confirm(`Delete "${c.name}" (${c.role})? This cannot be undone.`)) return;
    try {
      await deleteContact(c.id);
      setContacts(await listContacts());
      toast(`Removed "${c.name}".`, "info");
    } catch (err) {
      toast((err as Error).message, "err");
    }
  };

  if (!members || !contacts) {
    return (
      <div className="loading-pad">
        <p className="muted">Loading society directory…</p>
      </div>
    );
  }

  return (
    <div>
      {/* ── Subtabs Navigation ── */}
      <div className="card pad" style={{ marginBottom: "20px" }}>
        <div className="chipsrow" style={{ margin: 0 }}>
          <button
            className={`chip ${activeTab === "directory" ? "chip-on" : ""}`}
            onClick={() => setActiveTab("directory")}
            style={{ fontWeight: 600 }}
          >
            🏢 Floor-wise Flats & Owners
          </button>
          <button
            className={`chip ${activeTab === "management" ? "chip-on" : ""}`}
            onClick={() => setActiveTab("management")}
            style={{ fontWeight: 600 }}
          >
            🏛️ Society Management ({committeeMembers.length})
          </button>
          <button
            className={`chip ${activeTab === "emergency" ? "chip-on" : ""}`}
            onClick={() => setActiveTab("emergency")}
            style={{ fontWeight: 600 }}
          >
            🚨 Emergency & Utility Contacts ({emergencyContacts.length})
          </button>
        </div>
      </div>

      {/* ────────────────────────────────────────────────────────────────────────
          SUBTAB 1: Floor-wise Flats & Owners
         ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === "directory" && (
        <div>
          {/* Top action toolbar */}
          <div className="card pad" style={{ marginBottom: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <span className="eyebrow" style={{ margin: 0 }}>Wing:</span>
                <div className="chipsrow" style={{ margin: 0 }}>
                  {wings.map((w) => (
                    <button
                      key={w}
                      type="button"
                      className={`chip ${activeWing === w ? "chip-on" : ""}`}
                      onClick={() => setWing(w)}
                    >
                      Wing {w}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setShowGenerator(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  ⚡ Auto-Generate Flats
                </button>
              </div>
            </div>

            <div style={{ marginTop: "14px", display: "flex", gap: "12px", alignItems: "center" }}>
              <input
                className="input"
                placeholder="Search flat (e.g. 201), floor, or owner name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ maxWidth: "340px" }}
              />
              <span className="muted" style={{ fontSize: "13px" }}>
                Showing {list.length} flats in Wing {activeWing}
              </span>
            </div>
          </div>

          {/* Auto-generator modal */}
          {showGenerator && (
            <div className="modal-backdrop" onClick={() => !generating && setShowGenerator(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
                <div className="modal-head">
                  <div>
                    <p className="eyebrow">Wing {activeWing}</p>
                    <h3 style={{ fontSize: 22, margin: 0 }}>⚡ Auto-Generate Floors & Flats</h3>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => !generating && setShowGenerator(false)}
                  >
                    ✕
                  </button>
                </div>

                <p className="muted" style={{ fontSize: 13, margin: "4px 0 12px" }}>
                  Instantly creates all flats with standard numbering (e.g. Floor 1: 101, 102... Floor 2: 201, 202...).
                </p>

                <form onSubmit={handleAutoGenerate} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label>
                      <span className="eyebrow">Total Floors</span>
                      <input
                        className="input"
                        type="number"
                        min="1"
                        max="50"
                        value={genFloors}
                        onChange={(e) => setGenFloors(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      <span className="eyebrow">Flats Per Floor</span>
                      <input
                        className="input"
                        type="number"
                        min="1"
                        max="20"
                        value={genFlatsPerFloor}
                        onChange={(e) => setGenFlatsPerFloor(e.target.value)}
                        required
                      />
                    </label>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <label>
                      <span className="eyebrow">Start Floor</span>
                      <select
                        className="input"
                        value={genStartFloor}
                        onChange={(e) => setGenStartFloor(e.target.value)}
                      >
                        <option value="1">1st Floor (101...)</option>
                        <option value="0">Ground Floor (G1...)</option>
                      </select>
                    </label>
                    <label>
                      <span className="eyebrow">Default Maint. (₹)</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        placeholder="0"
                        value={genMaintenance}
                        onChange={(e) => setGenMaintenance(e.target.value)}
                      />
                    </label>
                  </div>

                  <div className="btnrow" style={{ marginTop: 14 }}>
                    <button className="btn btn-primary" disabled={generating}>
                      {generating ? "Generating…" : `Create ${Number(genFloors) * Number(genFlatsPerFloor)} Flats in Wing ${activeWing}`}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setShowGenerator(false)}
                      disabled={generating}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <div className="twocol members-layout">
            <div>
              {floorGroups.length === 0 ? (
                <div className="emptycard">
                  <IconBuilding size={30} />
                  <h3>No flats in Wing {activeWing}</h3>
                  <p className="muted">Use the "⚡ Auto-Generate Flats" tool above or add flats individually.</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                  {floorGroups.map(([floorNum, floorFlats]) => (
                    <div key={floorNum} className="card pad" style={{ padding: "16px 20px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", borderBottom: "1px solid var(--line)", paddingBottom: "8px" }}>
                        <h3 style={{ margin: 0, fontSize: "16px", color: "var(--brand-deep)" }}>
                          {floorLabel(floorNum)}
                        </h3>
                        <span className="badge" style={{ fontSize: "11px" }}>
                          {floorFlats.length} flats
                        </span>
                      </div>

                      <div style={{ overflowX: "auto" }}>
                        <table className="table" style={{ margin: 0 }}>
                          <thead>
                            <tr>
                              <th style={{ width: "90px" }}>Flat</th>
                              <th>Owner Name (Displayed at Payment)</th>
                              <th style={{ width: "160px" }}>Phone</th>
                              <th style={{ width: "80px" }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {floorFlats.map((m) => (
                              <FloorMemberRow
                                key={m.id}
                                member={m}
                                onChanged={upsertLocal}
                                onDeleted={() => setMembers((prev) => (prev ?? []).filter((x) => x.id !== m.id))}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add single flat form */}
            <form className="card pad addmember" onSubmit={addMember} style={{ alignSelf: "flex-start" }}>
              <h2 className="card-title">
                <IconPlus size={16} /> Add Flat in Wing {activeWing}
              </h2>
              <label>
                <span className="eyebrow">Flat number</span>
                <input
                  className="input"
                  placeholder="e.g. 101 or G2"
                  value={newMember.flat}
                  onChange={(e) => setNewMember({ ...newMember, flat: e.target.value })}
                  required
                />
              </label>
              <label>
                <span className="eyebrow">Phone (optional)</span>
                <input
                  className="input"
                  inputMode="tel"
                  placeholder="10-digit mobile"
                  value={newMember.phone}
                  onChange={(e) => setNewMember({ ...newMember, phone: e.target.value })}
                />
              </label>
              <label>
                <span className="eyebrow">Monthly maintenance (₹)</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0"
                  value={newMember.monthlyMaintenance}
                  onChange={(e) => setNewMember({ ...newMember, monthlyMaintenance: e.target.value })}
                />
              </label>
              <button className="btn btn-primary btn-block" disabled={adding}>
                {adding ? "Saving…" : <><IconPlus size={15} /> Add Flat</>}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────────
          SUBTAB 2: Society Management & Committee Members
         ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === "management" && (
        <div className="twocol members-layout">
          <div>
            <div className="card pad">
              <h2 className="card-title">🏛️ Elected Society Committee & Management</h2>
              <p className="muted" style={{ margin: "0 0 16px", fontSize: "13px" }}>
                Add and manage office bearers (Chairman, Secretary, Treasurer, Committee Members). Residents can view these in the Society Directory.
              </p>

              {committeeMembers.length === 0 ? (
                <div className="emptycard">
                  <IconUsers size={28} />
                  <h3>No committee members added</h3>
                  <p className="muted">Use the form on the right to add your Chairman, Secretary, or Treasurer.</p>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "14px" }}>
                  {committeeMembers.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        border: "1px solid var(--line)",
                        borderTop: "3px solid var(--brand)",
                        borderRadius: "10px",
                        padding: "16px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        gap: "10px",
                        background: "var(--card-bg, #fff)",
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span className="badge b-verified" style={{ fontWeight: 700, fontSize: "11px" }}>
                            COMMITTEE
                          </span>
                          <div style={{ display: "flex", gap: "4px" }}>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={() => startEditCommittee(c)}
                              title="Edit committee member"
                            >
                              <IconEdit size={13} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={() => removeContact(c)}
                              style={{ color: "var(--danger, #d32f2f)" }}
                              title="Remove committee member"
                            >
                              <IconTrash size={13} />
                            </button>
                          </div>
                        </div>

                        <div style={{ fontSize: "16px", fontWeight: 700, marginTop: "8px", color: "var(--fg)" }}>
                          {c.name}
                        </div>
                        <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--brand-deep, #1d4d3b)" }}>
                          {c.role}
                        </div>
                        <div style={{ fontSize: "13.5px", color: "var(--brand, #0066cc)", marginTop: "4px" }}>
                          📞 {c.phone}
                        </div>
                        {c.notes && <div className="muted" style={{ fontSize: "12px", marginTop: "4px" }}>{c.notes}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Add / Edit Committee Member Form */}
          <form className="card pad addmember" onSubmit={handleSaveCommittee} style={{ alignSelf: "flex-start" }}>
            <h2 className="card-title">
              {editingCommId ? <><IconEdit size={16} /> Edit Committee Member</> : <><IconPlus size={16} /> Add Committee Member</>}
            </h2>
            <label>
              <span className="eyebrow">Full Name</span>
              <input
                className="input"
                placeholder="e.g. Rohan Deshpande"
                value={commName}
                onChange={(e) => setCommName(e.target.value)}
                required
              />
            </label>
            <label>
              <span className="eyebrow">Designation / Role</span>
              <input
                className="input"
                list="committee-roles-list"
                placeholder="e.g. Secretary / Chairman / Treasurer"
                value={commRole}
                onChange={(e) => setCommRole(e.target.value)}
                required
              />
              <datalist id="committee-roles-list">
                <option value="Chairman" />
                <option value="Secretary" />
                <option value="Treasurer" />
                <option value="Joint Secretary" />
                <option value="Committee Member" />
              </datalist>
            </label>
            <label>
              <span className="eyebrow">Contact Phone Number</span>
              <input
                className="input"
                inputMode="tel"
                placeholder="10-digit mobile"
                value={commPhone}
                onChange={(e) => setCommPhone(e.target.value)}
                required
              />
            </label>
            <label>
              <span className="eyebrow">Flat & Availability (Optional)</span>
              <input
                className="input"
                placeholder="e.g. Flat A-402, 10 AM - 6 PM"
                value={commNotes}
                onChange={(e) => setCommNotes(e.target.value)}
              />
            </label>
            <div className="btnrow" style={{ marginTop: 10 }}>
              <button className="btn btn-primary btn-block" disabled={savingComm}>
                {savingComm ? "Saving…" : editingCommId ? "Save Changes" : <><IconPlus size={15} /> Add to Committee</>}
              </button>
              {editingCommId && (
                <button type="button" className="btn btn-ghost btn-block" onClick={cancelEditCommittee}>
                  Cancel Edit
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────────
          SUBTAB 3: Emergency & Utility Contacts
         ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === "emergency" && (
        <div className="twocol members-layout">
          <div>
            <div className="card pad">
              <h2 className="card-title">🚨 Emergency & Facility Helplines</h2>
              <p className="muted" style={{ margin: "0 0 16px", fontSize: "13px" }}>
                Building security desk, electricians, plumbers, lift breakdown, police, and fire station numbers. Visible in the resident directory.
              </p>

              {emergencyContacts.length === 0 ? (
                <div className="emptycard">
                  <IconPhone size={28} />
                  <h3>No emergency contacts added</h3>
                  <p className="muted">Use the form on the right to add security, electricians, or emergency numbers.</p>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
                  {emergencyContacts.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        border: "1px solid var(--line)",
                        borderTop: `3px solid ${c.category === "emergency" ? "var(--danger, #d32f2f)" : "var(--brand-mid, #2f7d4f)"}`,
                        borderRadius: "8px",
                        padding: "14px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        gap: "8px",
                        background: "var(--card-bg, #fff)",
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span className={`badge b-${c.category === "emergency" ? "rejected" : "pending"}`}>
                            {c.category.toUpperCase()}
                          </span>
                          <div style={{ display: "flex", gap: "4px" }}>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={() => startEditEmergency(c)}
                              title="Edit contact"
                            >
                              <IconEdit size={13} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={() => removeContact(c)}
                              style={{ color: "var(--danger, #d32f2f)" }}
                              title="Delete contact"
                            >
                              <IconTrash size={13} />
                            </button>
                          </div>
                        </div>
                        <div style={{ fontSize: "15px", fontWeight: 700, marginTop: "6px" }}>{c.name}</div>
                        <div className="muted" style={{ fontSize: "13px" }}>{c.role}</div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--brand, #0066cc)", marginTop: "4px" }}>
                          📞 {c.phone}
                        </div>
                        {c.notes && <div className="muted" style={{ fontSize: "11px", marginTop: "2px" }}>{c.notes}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Add / Edit Emergency Contact Form */}
          <form className="card pad addmember" onSubmit={handleSaveEmergency} style={{ alignSelf: "flex-start" }}>
            <h2 className="card-title">
              {editingEmergId ? <><IconEdit size={16} /> Edit Contact</> : <><IconPlus size={16} /> Add Contact</>}
            </h2>
            <label>
              <span className="eyebrow">Contact Name / Agency</span>
              <input
                className="input"
                placeholder="e.g. Ramesh Electrician / Gate #1"
                value={emergName}
                onChange={(e) => setEmergName(e.target.value)}
                required
              />
            </label>
            <label>
              <span className="eyebrow">Role / Service</span>
              <input
                className="input"
                placeholder="e.g. Electrician / Security Desk"
                value={emergRole}
                onChange={(e) => setEmergRole(e.target.value)}
                required
              />
            </label>
            <label>
              <span className="eyebrow">Phone Number</span>
              <input
                className="input"
                inputMode="tel"
                placeholder="98xxxxxxxx / 1800-xxx / 112"
                value={emergPhone}
                onChange={(e) => setEmergPhone(e.target.value)}
                required
              />
            </label>
            <label>
              <span className="eyebrow">Category</span>
              <select
                className="input"
                value={emergCategory}
                onChange={(e) => setEmergCategory(e.target.value as Contact["category"])}
              >
                <option value="services">Services (Electrician, Plumber, Pest)</option>
                <option value="staff">Staff & Security (Guard, Cleaning)</option>
                <option value="emergency">Emergency (Lift Breakdown, Police, Medical)</option>
              </select>
            </label>
            <label>
              <span className="eyebrow">Hours / Availability (Optional)</span>
              <input
                className="input"
                placeholder="e.g. 24/7 or 9 AM - 7 PM"
                value={emergNotes}
                onChange={(e) => setEmergNotes(e.target.value)}
              />
            </label>
            <div className="btnrow" style={{ marginTop: 10 }}>
              <button className="btn btn-primary btn-block" disabled={savingEmerg}>
                {savingEmerg ? "Saving…" : editingEmergId ? "Save Changes" : <><IconPlus size={15} /> Add Contact</>}
              </button>
              {editingEmergId && (
                <button type="button" className="btn btn-ghost btn-block" onClick={cancelEditEmergency}>
                  Cancel Edit
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function FloorMemberRow({
  member,
  onChanged,
  onDeleted,
}: {
  member: Member;
  onChanged: (m: Member) => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(toDraft(member));
  const [busy, setBusy] = useState(false);

  const dirty =
    draft.ownerName !== member.ownerName ||
    draft.phone !== member.phone ||
    draft.monthlyMaintenance !== String(member.monthlyMaintenance);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    setBusy(true);
    try {
      const cleaned: Member = {
        ...member,
        ownerName: draft.ownerName.trim(),
        phone: draft.phone.trim(),
        monthlyMaintenance: Math.max(0, Number(draft.monthlyMaintenance) || 0),
      };
      await saveMember(cleaned);
      setDraft(toDraft(cleaned));
      onChanged(cleaned);
      toast(`Flat ${cleaned.flat} saved with owner "${cleaned.ownerName || "—"}".`, "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const nameStr = member.ownerName ? ` (${member.ownerName})` : "";
    if (!window.confirm(`Remove flat ${member.id}${nameStr} from the register?`)) return;
    setBusy(true);
    try {
      await deleteMember(member.id);
      toast(`${member.id} removed.`, "ok");
      onDeleted();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className={member.active ? "" : "row-off"}>
      <td>
        <b style={{ fontSize: "15px" }}>{member.flat}</b>
        <small className="muted block">{member.id}</small>
      </td>
      <td>
        <input
          className="input"
          placeholder="Add owner name…"
          value={draft.ownerName}
          onChange={(e) => set({ ownerName: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && void save()}
          style={{ width: "100%", margin: 0 }}
        />
      </td>
      <td>
        <input
          className="input"
          inputMode="tel"
          placeholder="— phone"
          value={draft.phone}
          onChange={(e) => set({ phone: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && void save()}
          style={{ width: "100%", margin: 0 }}
        />
      </td>
      <td>
        <div style={{ display: "flex", gap: "6px" }}>
          {dirty && (
            <button
              className="btn btn-primary btn-sm"
              onClick={save}
              disabled={busy}
              title="Save changes"
            >
              <IconCheck size={13} />
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={remove}
            disabled={busy}
            title="Delete flat"
            style={{ color: "var(--danger, #d32f2f)" }}
          >
            <IconTrash size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}
