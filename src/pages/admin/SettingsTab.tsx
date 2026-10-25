import { useState } from "react";
import { IconCheck, IconCog, IconShield } from "../../components/Icons";
import { useToast } from "../../components/Toast";
import { isDemo } from "../../lib/firebase";
import { useAdmin } from "./AdminCtx";
import type { SocietySettings } from "../../lib/types";

export default function SettingsTab() {
  const { settings, commit } = useAdmin();
  const { toast } = useToast();
  const [draft, setDraft] = useState<SocietySettings>(settings);
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<SocietySettings>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const pinOk = /^\d{4,8}$/.test(draft.adminPin.trim());
    if (!pinOk) {
      toast("The PIN should be 4–8 digits.", "err");
      return;
    }
    if (draft.usageLimitMB < 32) {
      toast("A soft limit under 32 MB would nag instantly — keep it realistic (256–700).", "err");
      return;
    }
    setBusy(true);
    try {
      const cleaned: SocietySettings = {
        ...draft,
        societyName: draft.societyName.trim() || "My Housing Society",
        upiId: draft.upiId.trim(),
        payeeName: draft.payeeName.trim(),
        wings: draft.wings.map((w) => w.trim()).filter(Boolean),
        adminPin: draft.adminPin.trim(),
        adminEmail: draft.adminEmail.trim(),
        usageLimitMB: Math.round(draft.usageLimitMB),
      };
      await commit(cleaned);
      setDraft(cleaned);
      toast("Society details saved everywhere — receipts, Excel letterhead and alerts.", "ok");
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="settingsgrid" onSubmit={save}>
      <div className="card pad">
        <h2 className="card-title">
          <IconCog size={16} /> The society, on paper
        </h2>
        <p className="muted">These spell the letterhead — receipts, the Excel register and file names all take it from here.</p>
        <label>
          <span className="eyebrow">Registered society name</span>
          <input
            className="input"
            value={draft.societyName}
            onChange={(e) => set({ societyName: e.target.value })}
            required
          />
        </label>
        <label>
          <span className="eyebrow">Address line 1</span>
          <input className="input" value={draft.address1} onChange={(e) => set({ address1: e.target.value })} />
        </label>
        <label>
          <span className="eyebrow">Address line 2</span>
          <input className="input" value={draft.address2} onChange={(e) => set({ address2: e.target.value })} />
        </label>
        <label>
          <span className="eyebrow">Registration number</span>
          <input className="input" value={draft.regNo} onChange={(e) => set({ regNo: e.target.value })} />
        </label>
      </div>

      <div className="card pad">
        <h2 className="card-title">Money &amp; wings</h2>
        <p className="muted">The UPI identity that receipts and the QR code resolve against.</p>
        <label>
          <span className="eyebrow">UPI ID (VPA)</span>
          <input
            className="input mono"
            value={draft.upiId}
            onChange={(e) => set({ upiId: e.target.value })}
            placeholder="society@bank"
            required
          />
        </label>
        <label>
          <span className="eyebrow">Payee name shown in UPI apps</span>
          <input className="input" value={draft.payeeName} onChange={(e) => set({ payeeName: e.target.value })} />
        </label>
        <label>
          <span className="eyebrow">Wings (comma-separated)</span>
          <input
            className="input"
            value={draft.wings.join(", ")}
            onChange={(e) => set({ wings: e.target.value.split(",") })}
            placeholder="A, B, C"
          />
        </label>
        <p className="hint">
          Adding a wing doesn't create flats — register them one by one under Flats &amp; members. Removing a wing here
          only hides it from the picker; its old receipts remain.
        </p>
      </div>

      <div className="card pad">
        <h2 className="card-title"><IconShield size={16} /> How payments are verified</h2>
        <p className="muted">
          Residents pay straight to the society UPI ID over the QR — no third-party gateway, no commission. Their
          receipt stays <b>pending</b> until you verify it here; dues drop the moment you do.
        </p>
        <ul className="muted">
          <li>
            <b>Screenshot reader.</b> Residents can attach their UPI app's payment screenshot; the app reads it in the
            browser (OCR) and pulls out the 12-digit UTR, the amount and the result — auto-filling the reference.
            You see the verdict chip (matched / check / unread) plus the image on every receipt row.
          </li>
          <li>
            <b>Double-tap &amp; slow-network guard.</b> One pending draft per flat per month — double clicks, page
            refreshes or a second phone all continue the same receipt instead of creating duplicates, and the
            submit buttons are locked while a write is in flight.
          </li>
          <li>
            <b>Storage honesty.</b> Screenshots are compressed to ≈½ MB before saving and count toward the collection's
            usage estimate — the same low-storage alert and archive/purge flow still applies.
          </li>
        </ul>
        <p className="fineprint">
          The screenshot verdict is a hint, never an auto-approval — only your Verify click settles dues.
        </p>
      </div>

      <div className="card pad">
        <h2 className="card-title">Committee &amp; alarms</h2>
        <div className="pairgrid">
          <label>
            <span className="eyebrow">Admin PIN (4–8 digits)</span>
            <input
              className="input mono"
              inputMode="numeric"
              value={draft.adminPin}
              onChange={(e) => set({ adminPin: e.target.value.replace(/\D/g, "").slice(0, 8) })}
              required
            />
          </label>
          <label>
            <span className="eyebrow">Committee e-mail (alert recipient)</span>
            <input
              className="input"
              type="email"
              value={draft.adminEmail}
              onChange={(e) => set({ adminEmail: e.target.value })}
              placeholder="secretary@society.in"
            />
          </label>
        </div>
        <label>
          <span className="eyebrow">Firestore soft limit (MB)</span>
          <input
            className="input"
            type="number"
            min="32"
            max="1024"
            value={draft.usageLimitMB}
            onChange={(e) => set({ usageLimitMB: Number(e.target.value) })}
          />
        </label>
        <p className="hint">
          The 90% crossing triggers the no-reply alert → archive to PC → purge flow. Fire-and-forget: residents never see
          this machinery. {isDemo && "(Demo mode stores alerts locally.)"}
        </p>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : <><IconCheck size={15} /> Save society settings</>}
        </button>
      </div>
    </form>
  );
}
