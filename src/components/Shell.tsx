import { useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import Logo from "./Logo";
import { loadSettings, loadUsage } from "../lib/store";
import { isDemo } from "../lib/firebase";
import { IconAlert } from "./Icons";
import type { SocietySettings, Usage } from "../lib/types";

export default function Shell({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SocietySettings | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, u] = await Promise.all([loadSettings(), loadUsage()]);
        if (!alive) return;
        setSettings(s);
        setUsage(u);
      } catch {
        /* shell is chrome-only; pages surface their own errors */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const limitBytes = Math.max(1, settings?.usageLimitMB ?? 512) * 1024 * 1024;
  const pct = usage && limitBytes ? Math.min(100, (usage.estBytes / limitBytes) * 100) : 0;
  const warn = pct >= 75;

  return (
    <div className="app">
      {warn && (
        <div className="sys-banner">
          <IconAlert size={15} />
          <span>
            Firestore storage is at <b>{Math.round(pct)}%</b> of the configured soft limit.{" "}
            <NavLink to="/admin">Admin → Archive</NavLink> to download the register &amp; purge old records.
          </span>
        </div>
      )}

      <header className="topbar">
        <div className="shell topbar-in">
          <NavLink to="/" className="brand">
            <Logo size={40} />
            <span className="brand-text">
              <strong>{settings?.societyName ?? "Society Khata"}</strong>
              <em>Maintenance payment ledger</em>
            </span>
          </NavLink>
          <nav className="topnav">
            <NavLink to="/" end className={({ isActive }) => (isActive ? "on" : "")}>
              Pay
            </NavLink>
            <NavLink to="/history" className={({ isActive }) => (isActive ? "on" : "")}>
              My payments
            </NavLink>
            <NavLink to="/admin" className={({ isActive }) => (isActive ? "on" : "")}>
              Admin
            </NavLink>
          </nav>
        </div>
      </header>

      {isDemo && (
        <div className="shell">
          <div className="demo-note">
            <b>Demo mode.</b> Data is kept in this browser only (localStorage) so you can try everything end-to-end. Add
            your Firebase keys in <code>.env</code> to switch to Firestore — the app migrates over with no code changes.
          </div>
        </div>
      )}

      <main className="shell page">{children}</main>

      <footer className="footer shell">
        <Logo size={22} />
        <span>
          © {new Date().getFullYear()} {settings?.societyName ?? "Society Khata"} · built on UPI + Firestore · archives saved to your own machine
        </span>
      </footer>
    </div>
  );
}
