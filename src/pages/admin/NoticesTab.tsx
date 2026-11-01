import { useEffect, useState } from "react";
import { IconBoard, IconPin, IconTrash } from "../../components/Icons";
import { useToast } from "../../components/Toast";
import { deleteNotice, listNotices, newNoticeId, saveNotice } from "../../lib/store";
import type { Notice, NoticeTone } from "../../lib/types";

const TONES: Array<{ key: NoticeTone; label: string }> = [
  { key: "info", label: "General" },
  { key: "warn", label: "Warning" },
  { key: "event", label: "Event" },
];

/** Committee tab: post, pin, edit and take down board notices. */
export default function NoticesTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Notice[] | null>(null);
  const [draft, setDraft] = useState({ title: "", body: "", tone: "info" as NoticeTone, pinned: false });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listNotices()
      .then(setRows)
      .catch((e) => toast(e.message, "err"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetDraft = () => {
    setDraft({ title: "", body: "", tone: "info", pinned: false });
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
    setBusy(true);
    try {
      const n: Notice = {
        id: editingId ?? newNoticeId(),
        title: draft.title.trim(),
        body: draft.body.trim(),
        tone: draft.tone,
        pinned: draft.pinned,
        createdAt: editingId ? (rows?.find((r) => r.id === editingId)?.createdAt ?? new Date().toISOString()) : new Date().toISOString(),
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
    setDraft({ title: n.title, body: n.body, tone: n.tone, pinned: Boolean(n.pinned) });
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
