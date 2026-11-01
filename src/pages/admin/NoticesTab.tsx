import { useEffect, useState } from "react";
import { IconBoard, IconPin, IconTrash } from "../../components/Icons";
import { useToast } from "../../components/Toast";
import { deleteNotice, listMembers, listNotices, loadSettings, newNoticeId, saveNotice } from "../../lib/store";
import type { Member, Notice, NoticeTone, SocietySettings } from "../../lib/types";
import { floorLabel, getFlatFloor } from "../../lib/util";

const TONES: Array<{ key: NoticeTone; label: string }> = [
  { key: "info", label: "General" },
  { key: "warn", label: "Warning" },
  { key: "event", label: "Event" },
];

const TARGET_TYPES = [
  { key: "all" as const, label: "🌐 Society-wide", desc: "Visible to all residents" },
  { key: "floor" as const, label: "🏢 Floor-wise", desc: "For a specific floor" },
  { key: "flat" as const, label: "🚪 Flat-wise", desc: "For a specific flat" },
  { key: "wing" as const, label: "🏛️ Wing-wise", desc: "For a specific wing" },
];

interface NoticeDraft {
  title: string;
  body: string;
  tone: NoticeTone;
  pinned: boolean;
  targetType: "all" | "floor" | "flat" | "wing";
  targetFloor: number;
  targetFlat: string;
  targetWing: string;
}

const defaultDraft: NoticeDraft = {
  title: "",
  body: "",
  tone: "info",
  pinned: false,
  targetType: "all",
  targetFloor: 1,
  targetFlat: "",
  targetWing: "A",
};

/** Committee tab: post, pin, edit and take down board notices with floor/flat targeting. */
export default function NoticesTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Notice[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [settings, setSettings] = useState<SocietySettings | null>(null);
  const [draft, setDraft] = useState<NoticeDraft>(defaultDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listNotices()
      .then(setRows)
      .catch((e) => toast(e.message, "err"));

    listMembers()
      .then(setMembers)
      .catch(() => {});

    loadSettings()
      .then(setSettings)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compute available unique floors and wings
  const availableFloors = Array.from(
    new Set(members.map((m) => getFlatFloor(m.flat, m.floor)))
  ).sort((a, b) => a - b);
  const floorsList = availableFloors.length > 0 ? availableFloors : [0, 1, 2, 3, 4, 5, 6];
  const wingsList = settings?.wings?.length ? settings.wings : ["A", "B", "C"];

  const resetDraft = () => {
    setDraft({
      ...defaultDraft,
      targetFloor: floorsList[0] ?? 1,
      targetWing: wingsList[0] ?? "A",
      targetFlat: members[0]?.flat ?? "",
    });
    setEditingId(null);
  };

  const save = async () => {
    if (busy) return;
    if (!draft.title.trim() || draft.title.trim().length < 4) {
      toast("Give the notice a title (4+ characters).", "err");
      return;
    }
    if (!draft.body.trim()) {
      toast("The notice can't be empty.", "err");
      return;
    }
    if (draft.targetType === "flat" && !draft.targetFlat.trim()) {
      toast("Please specify a flat number.", "err");
      return;
    }

    setBusy(true);
    try {
      const n: Notice = {
        id: editingId ?? newNoticeId(),
        title: draft.title.trim(),
        body: draft.body.trim(),
        tone: draft.tone,
        pinned: draft.pinned,
        createdAt: editingId ? (rows?.find((r) => r.id === editingId)?.createdAt ?? new Date().toISOString()) : new Date().toISOString(),
        targetType: draft.targetType,
        targetFloor: draft.targetType === "floor" ? Number(draft.targetFloor) : undefined,
        targetFlat: draft.targetType === "flat" ? draft.targetFlat.trim() : undefined,
        targetWing: draft.targetType === "wing" ? draft.targetWing.trim() : undefined,
      };
      await saveNotice(n);
      setRows(await listNotices());
      resetDraft();
      toast(editingId ? "Notice updated." : "Notice posted to the board.", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const edit = (n: Notice) => {
    setEditingId(n.id);
    setDraft({
      title: n.title,
      body: n.body,
      tone: n.tone,
      pinned: Boolean(n.pinned),
      targetType: n.targetType ?? "all",
      targetFloor: n.targetFloor ?? floorsList[0] ?? 1,
      targetFlat: n.targetFlat ?? "",
      targetWing: n.targetWing ?? wingsList[0] ?? "A",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const togglePin = async (n: Notice) => {
    try {
      await saveNotice({ ...n, pinned: !n.pinned });
      setRows(await listNotices());
      toast(n.pinned ? "Unpinned." : "Pinned to the top of the board.", "info");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const remove = async (n: Notice) => {
    if (!window.confirm(`Take down "${n.title}"? This cannot be undone.`)) return;
    try {
      await deleteNotice(n.id);
      setRows(await listNotices());
      toast("Notice removed from the board.", "info");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <div className="noticegrid">
      <div>
        <div className="card pad">
          <h2 className="card-title"><IconBoard size={16} /> {editingId ? "Edit notice" : "Post a notice"}</h2>
          <div className="pairgrid">
            <label style={{ gridColumn: "1 / -1" }}>
              <span className="eyebrow">Title</span>
              <input
                className="input"
                value={draft.title}
                maxLength={80}
                placeholder="e.g. Water supply off Sunday 7–9 a.m."
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>

            {/* Target Audience / Scope Selector */}
            <div style={{ gridColumn: "1 / -1" }}>
              <span className="eyebrow">Target Audience / Scope</span>
              <div className="chipsrow" style={{ marginTop: 4, marginBottom: 8 }}>
                {TARGET_TYPES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`chip ${draft.targetType === t.key ? "chip-on" : ""}`}
                    onClick={() => setDraft({ ...draft, targetType: t.key })}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {draft.targetType === "floor" && (
                <div style={{ background: "var(--paper-soft)", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--line)" }}>
                  <span className="eyebrow">Select Floor</span>
                  <div className="chipsrow" style={{ marginTop: 4 }}>
                    {floorsList.map((f) => (
                      <button
                        key={f}
                        type="button"
                        className={`chip ${Number(draft.targetFloor) === f ? "chip-on" : ""}`}
                        onClick={() => setDraft({ ...draft, targetFloor: f })}
                      >
                        {floorLabel(f)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {draft.targetType === "flat" && (
                <div style={{ background: "var(--paper-soft)", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--line)" }}>
                  <span className="eyebrow">Select or Enter Flat Number</span>
                  <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      className="input"
                      style={{ maxWidth: 160 }}
                      value={draft.targetFlat}
                      placeholder="e.g. 101 or A-101"
                      onChange={(e) => setDraft({ ...draft, targetFlat: e.target.value.toUpperCase() })}
                    />
                    {members.length > 0 && (
                      <select
                        className="input"
                        style={{ maxWidth: 180 }}
                        value={draft.targetFlat}
                        onChange={(e) => setDraft({ ...draft, targetFlat: e.target.value })}
                      >
                        <option value="">Quick pick from flats…</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.flat}>
                            Flat {m.wing ? `${m.wing}-${m.flat}` : m.flat} {m.ownerName ? `(${m.ownerName})` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              )}

              {draft.targetType === "wing" && (
                <div style={{ background: "var(--paper-soft)", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--line)" }}>
                  <span className="eyebrow">Select Wing</span>
                  <div className="chipsrow" style={{ marginTop: 4 }}>
                    {wingsList.map((w) => (
                      <button
                        key={w}
                        type="button"
                        className={`chip ${draft.targetWing === w ? "chip-on" : ""}`}
                        onClick={() => setDraft({ ...draft, targetWing: w })}
                      >
                        Wing {w}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <label style={{ gridColumn: "1 / -1" }}>
              <span className="eyebrow">Details</span>
              <textarea
                className="input"
                rows={5}
                value={draft.body}
                placeholder="Write like a secretary, not a bot. Times, dates, what to do."
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </label>
            <label>
              <span className="eyebrow">Tone</span>
              <div className="chipsrow">
                {TONES.map((t) => (
                  <button key={t.key} type="button" className={`chip ${draft.tone === t.key ? "chip-on" : ""}`} onClick={() => setDraft({ ...draft, tone: t.key })}>
                    {t.label}
                  </button>
                ))}
              </div>
            </label>
            <label>
              <span className="eyebrow">Pinned</span>
              <div>
                <button type="button" className={`chip ${draft.pinned ? "chip-on" : ""}`} onClick={() => setDraft({ ...draft, pinned: !draft.pinned })}>
                  <IconPin size={12} /> {draft.pinned ? "Pinned" : "Not pinned"}
                </button>
              </div>
            </label>
          </div>
          <div className="btnrow" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : editingId ? "Save changes" : "Post to the board"}
            </button>
            {editingId && (
              <button className="btn btn-ghost" onClick={resetDraft}>
                Cancel edit
              </button>
            )}
          </div>
        </div>
      </div>

      <div>
        <div className="stackcol">
          {(rows ?? []).map((n) => (
            <article key={n.id} className={`notice-card nt-${n.tone} ${n.pinned ? "pinned" : ""}`}>
              <header className="nhead">
                <div className="ntitle">
                  {n.pinned && <span className="pinflag"><IconPin size={11} /> pinned</span>}
                  <h3>{n.title}</h3>
                  {n.targetType === "floor" && (
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "rgba(3, 105, 161, 0.12)", color: "#0369a1", fontWeight: 600 }}>
                      🏢 {floorLabel(n.targetFloor ?? 1)}
                    </span>
                  )}
                  {n.targetType === "flat" && (
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "rgba(126, 34, 206, 0.12)", color: "#7e22ce", fontWeight: 600 }}>
                      🚪 Flat {n.targetFlat}
                    </span>
                  )}
                  {n.targetType === "wing" && (
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "rgba(180, 83, 9, 0.12)", color: "#b45309", fontWeight: 600 }}>
                      🏛️ Wing {n.targetWing}
                    </span>
                  )}
                  {(!n.targetType || n.targetType === "all") && (
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "var(--brand-soft)", color: "var(--brand-deep)", fontWeight: 600 }}>
                      🌐 Society-wide
                    </span>
                  )}
                </div>
                <span className="ndate">
                  {new Date(n.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </header>
              <p className="nbody">{n.body}</p>
              <div className="btnrow" style={{ marginTop: 10 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => togglePin(n)}>
                  {n.pinned ? "Unpin" : "Pin to top"}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => edit(n)}>
                  Edit
                </button>
                <button className="btn btn-ghost btn-sm nbtn-bad" onClick={() => remove(n)}>
                  <IconTrash size={13} /> Remove
                </button>
              </div>
            </article>
          ))}
          {rows && rows.length === 0 && (
            <div className="emptycard">
              <IconBoard size={26} />
              <h3>Nothing on the board</h3>
              <p className="muted">Post your first bulletin with the form.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
