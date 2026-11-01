import { useEffect, useMemo, useState } from "react";
import { IconBuilding, IconPlus, IconTrash } from "../../components/Icons";
import { useToast } from "../../components/Toast";
import type { Member } from "../../lib/types";
import { deleteMember, listMembers, saveMember } from "../../lib/store";
import { inr, memberId } from "../../lib/util";
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

export default function MembersTab() {
  const { settings } = useAdmin();
  const { toast } = useToast();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [wing, setWing] = useState("");
  const [newMember, setNewMember] = useState({ flat: "", phone: "", monthlyMaintenance: "", dueBalance: "0" });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    listMembers()
      .then((ms) => {
        setMembers(ms);
        if (ms.length > 0 && !wing) setWing(ms[0].wing);
      })
      .catch((e) => toast(e.message, "err"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wings = useMemo(() => {
    const set = new Set<string>(settings.wings);
    (members ?? []).forEach((m) => set.add(m.wing));
    return Array.from(set).sort();
  }, [settings.wings, members]);

  const activeWing = wing || wings[0] || "";
  const list = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.wing === activeWing)
        .sort((a, b) => a.flat.localeCompare(b.flat, "en", { numeric: true })),
    [members, activeWing]
  );

  const totals = useMemo(
    () =>
      list.reduce(
        (acc, m) => ({
          maintenance: acc.maintenance + m.monthlyMaintenance,
          dues: acc.dues + (m.active ? m.dueBalance : 0),
        }),
        { maintenance: 0, dues: 0 }
      ),
    [list]
  );

  const upsertLocal = (m: Member) => setMembers((ms) => [...(ms ?? []).filter((x) => x.id !== m.id), m]);

  const addMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const flatTrim = newMember.flat.trim();
    if (!flatTrim) {
      toast("Flat number is required.", "err");
      return;
    }
    const id = memberId(activeWing, flatTrim);
    if ((members ?? []).some((m) => m.id === id)) {
      toast(`${id} is already registered.`, "err");
      return;
    }
    setAdding(true);
    try {
      const m: Member = {
        id,
        wing: activeWing,
        flat: flatTrim,
        ownerName: "",
        phone: newMember.phone.trim(),
        monthlyMaintenance: Math.max(0, Number(newMember.monthlyMaintenance) || 0),
        dueBalance: Math.max(0, Number(newMember.dueBalance) || 0),
        active: true,
      };
      await saveMember(m);
      upsertLocal(m);
      setNewMember({ flat: "", phone: "", monthlyMaintenance: "", dueBalance: "0" });
      toast(id + " added to Wing " + activeWing + ".", "ok");
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="twocol members-layout">
      <div>
        <div className="chipbar">
          {wings.map((w) => (
            <button key={w} className={`chip ${activeWing === w ? "chip-on" : ""}`} onClick={() => setWing(w)}>
              Wing {w}
            </button>
          ))}
        </div>
        <div className="summaryline">
          <span>
            <b>{list.length}</b> flats
          </span>
          <span>
            <b>{inr(totals.maintenance)}</b> billed monthly
          </span>
          <span className={totals.dues > 0 ? "dues-hot" : ""}>
            <b>{inr(totals.dues)}</b> outstanding
          </span>
        </div>

        {list.length === 0 ? (
          <div className="emptycard">
            <IconBuilding size={28} />
            <h3>No flats in Wing {activeWing}</h3>
            <p className="muted">Register the first flat with the form beside.</p>
          </div>
        ) : (
          <table className="table memberstable">
            <thead>
              <tr>
                <th>Flat</th>
                <th>Owner</th>
                <th>Phone</th>
                <th className="num">Monthly</th>
                <th className="num">Dues</th>
                <th>On</th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  onChanged={(next) => {
                    upsertLocal(next);
                  }}
                  onDeleted={() => setMembers((ms) => (ms ?? []).filter((x) => x.id !== m.id))}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form className="card pad addmember" onSubmit={addMember}>
        <h2 className="card-title">
          <IconPlus size={16} /> Add a flat to Wing {activeWing}
        </h2>
        <label>
          <span className="eyebrow">Flat number</span>
          <input
            className="input"
            placeholder="e.g. 402"
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
            placeholder="98xxxxxxxx"
            value={newMember.phone}
            onChange={(e) => setNewMember({ ...newMember, phone: e.target.value })}
          />
        </label>
        <div className="pairgrid">
          <label>
            <span className="eyebrow">Monthly maintenance (₹)</span>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              placeholder="2800"
              value={newMember.monthlyMaintenance}
              onChange={(e) => setNewMember({ ...newMember, monthlyMaintenance: e.target.value })}
              required
            />
          </label>
          <label>
            <span className="eyebrow">Opening dues (₹)</span>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={newMember.dueBalance}
              onChange={(e) => setNewMember({ ...newMember, dueBalance: e.target.value })}
            />
          </label>
        </div>
        <button className="btn btn-primary btn-block" disabled={adding}>
          {adding ? "Saving…" : <><IconPlus size={15} /> Register flat</>}
        </button>
        <p className="fineprint">
          Dues open at the value you enter; every verified payment subtracts from it. Deleting a flat never deletes its
          payment receipts.
        </p>
      </form>
    </div>
  );
}

function MemberRow({
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
    draft.monthlyMaintenance !== String(member.monthlyMaintenance) ||
    draft.dueBalance !== String(member.dueBalance);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    setBusy(true);
    try {
      const cleaned: Member = {
        ...member,
        ownerName: draft.ownerName.trim(),
        phone: draft.phone.trim(),
        monthlyMaintenance: Math.max(0, Number(draft.monthlyMaintenance) || 0),
        dueBalance: Math.max(0, Number(draft.dueBalance) || 0),
      };
      await saveMember(cleaned);
      setDraft(toDraft(cleaned));
      onChanged(cleaned);
      toast(`${cleaned.id} saved.`, "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const nameStr = member.ownerName ? ` (${member.ownerName})` : "";
    if (!window.confirm(`Remove flat ${member.id}${nameStr} from the register? Payment receipts live in the payments collection, not here.`)) return;
    setBusy(true);
    try {
      await deleteMember(member.id);
      toast(`${member.id} removed.`, "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className={member.active ? "" : "row-off"}>
      <td>
        <b>{member.flat}</b>
        <small className="muted block">{member.id}</small>
      </td>
      <td>
        <input
          className="input inline"
          placeholder="—"
          value={draft.ownerName}
          onChange={(e) => set({ ownerName: e.target.value })}
          aria-label="Owner name"
        />
      </td>
      <td>
        <input
          className="input inline narrow"
          inputMode="tel"
          placeholder="—"
          value={draft.phone}
          onChange={(e) => set({ phone: e.target.value })}
          aria-label="Phone"
        />
      </td>
      <td className="num">
        <input
          className="input inline tiny"
          type="number"
          min="0"
          step="0.01"
          value={draft.monthlyMaintenance}
          onChange={(e) => set({ monthlyMaintenance: e.target.value })}
          aria-label="Monthly maintenance"
        />
      </td>
      <td className="num">
        <input
          className={`input inline tiny ${Number(draft.dueBalance) > 0 ? "dues-input" : ""}`}
          type="number"
          min="0"
          step="0.01"
          value={draft.dueBalance}
          onChange={(e) => set({ dueBalance: e.target.value })}
          aria-label="Due balance"
        />
      </td>
      <td>
        <input
          type="checkbox"
          checked={member.active}
          onChange={(e) => toggleActive(e.target.checked)}
          aria-label="Active"
        />
      </td>
      <td>
        <button className="btn btn-sm btn-outline" onClick={save} disabled={!dirty || busy}>
          Save
        </button>
      </td>
      <td>
        <button className="iconbtn bad" onClick={remove} disabled={busy} title="Remove flat">
          <IconTrash size={15} />
        </button>
      </td>
    </tr>
  );

  async function toggleActive(next: boolean) {
    setBusy(true);
    try {
      await saveMember({ ...member, active: next });
      onChanged({ ...member, active: next });
      toast(next ? `${member.id} re-activated.` : `${member.id} set inactive.`, "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }
}
