import { useEffect, useState } from "react";
import { IconAlert, IconArchive, IconCog, IconDashboard, IconLock, IconShield, IconUsers } from "../components/Icons";
import { useToast } from "../components/Toast";
import { isDemo } from "../lib/firebase";
import { loadSettings, saveSettings } from "../lib/store";
import type { SocietySettings } from "../lib/types";
import ArchiveTab from "./admin/ArchiveTab";
import DashboardTab from "./admin/DashboardTab";
import MembersTab from "./admin/MembersTab";
import PaymentsTab from "./admin/PaymentsTab";
import SettingsTab from "./admin/SettingsTab";
import { AdminProvider } from "./admin/AdminCtx";

type TabKey = "dashboard" | "payments" | "members" | "archive" | "settings";

const TABS: Array<{ key: TabKey; label: string; icon: (p: { size?: number }) => JSX.Element }> = [
  { key: "dashboard", label: "Dashboard", icon: IconDashboard },
  { key: "payments", label: "Payments", icon: IconShield },
  { key: "members", label: "Flats & members", icon: IconUsers },
  { key: "archive", label: "Archive & purge", icon: IconArchive },
  { key: "settings", label: "Settings", icon: IconCog },
];

export default function AdminPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<SocietySettings | null>(null);
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem("sk.adminGate") === "1");
  const [tab, setTab] = useState<TabKey>("dashboard");

  useEffect(() => {
    loadSettings()
      .then(setSettings)
      .catch((e) => toast(e.message, "err"));
    const onSwitch = (e: Event) => setTab((e as CustomEvent<string>).detail as TabKey);
    window.addEventListener("sk-admintab", onSwitch);
    return () => window.removeEventListener("sk-admintab", onSwitch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = async (s: SocietySettings) => {
    setSettings(s);
    await saveSettings(s);
  };

  if (!settings) {
    return (
      <div className="loading-pad">
        <p className="muted">Opening the committee desk…</p>
      </div>
    );
  }

  if (!unlocked) {
    return <PinGate settings={settings} onUnlock={() => { sessionStorage.setItem("sk.adminGate", "1"); setUnlocked(true); }} />;
  }

  return (
    <AdminProvider value={{ settings, commit }}>
      <section className="hero">
        <p className="eyebrow">Committee desk</p>
        <h1>The secrets of the ledger.</h1>
        <p className="lede">Verify payments, set maintenance amounts, and watch the archive lifecycle in one place.</p>
      </section>

      <nav className="admintabs" aria-label="Admin sections">
        {TABS.map((t) => (
          <button key={t.key} className={`admintab ${tab === t.key ? "on" : ""}`} onClick={() => setTab(t.key)}>
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "dashboard" && <DashboardTab />}
      {tab === "payments" && <PaymentsTab />}
      {tab === "members" && <MembersTab />}
      {tab === "archive" && <ArchiveTab />}
      {tab === "settings" && <SettingsTab />}
    </AdminProvider>
  );
}

function PinGate({ settings, onUnlock }: { settings: SocietySettings; onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  return (
    <div className="pin-wrap">
      <form
        className="card pad pin-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (pin.trim() === settings.adminPin.trim()) {
            setErr("");
            onUnlock();
          } else {
            setErr("That's not the committee PIN.");
          }
        }}
      >
        <span className="pin-ico">
          <IconLock size={24} />
        </span>
        <h2>Committee access</h2>
        <p className="muted">The admin ledger is behind a PIN. Change it any time in Settings.</p>
        <input
          className="input pin-input"
          type="password"
          inputMode="numeric"
          autoFocus
          placeholder="· · · ·"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\s/g, ""))}
          required
        />
        {err && (
          <p className="warnline">
            <IconAlert size={14} /> {err}
          </p>
        )}
        <button className="btn btn-primary btn-block" type="submit">
          Unlock admin
        </button>
        {isDemo && <p className="fineprint">Demo PIN: <code>2408</code></p>}
      </form>
    </div>
  );
}
