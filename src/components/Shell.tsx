import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
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
        if (s?.societyName) {
          document.title = `${s.societyName} · Maintenance`;
        }
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
    <div className="min-h-screen flex flex-col bg-background text-on-surface antialiased font-sans">
      {/* Soft storage alert banner */}
      {warn && (
        <div className="bg-warning/10 text-warning px-4 py-2 text-center text-body-sm flex items-center justify-center gap-2 border-b border-warning/20 fixed top-0 left-0 w-full z-[60]">
          <IconAlert size={15} />
          <span>
            Firestore storage is at <strong>{Math.round(pct)}%</strong> of the configured soft limit.{" "}
            <NavLink to="/admin" className="underline font-semibold ml-1">
              Committee Desk → Archive
            </NavLink>
          </span>
        </div>
      )}

      {/* Top Header Navigation matching Stitch Ivory Estate design */}
      <header className={`fixed ${warn ? "top-8" : "top-0"} left-0 w-full z-50 bg-surface/90 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] border-b border-line/60 transition-all`}>
        <div className="h-16 sm:h-20 max-w-[1280px] mx-auto px-4 sm:px-gutter flex items-center justify-between gap-3 sm:gap-4 flex-nowrap">
          <div className="flex items-center gap-3 shrink-0">
            <Link to="/" className="flex items-center gap-2.5 cursor-pointer group shrink-0 max-w-[280px] sm:max-w-[440px]">
              <div className="w-10 h-10 min-w-[40px] min-h-[40px] shrink-0 rounded-xl overflow-hidden flex items-center justify-center shadow-sm bg-black border border-gold-soft-deep/30">
                <Logo size={40} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-title-md text-[15px] sm:text-title-md text-on-surface tracking-tight leading-tight group-hover:text-primary transition-colors truncate font-bold" title={settings?.societyName || "Housing Society"}>
                  {settings?.societyName || "Housing Society"}
                </span>
                <span className="font-label-sm text-[10px] uppercase tracking-widest text-primary font-bold mt-0.5 whitespace-nowrap">
                  {settings?.regNo ? `Reg. ${settings.regNo}` : "Society Ledger"}
                </span>
              </div>
            </Link>
          </div>

          <nav className="hidden lg:flex items-center gap-1.5 shrink-0" aria-label="Main Navigation">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                isActive
                  ? "px-3.5 py-1.5 transition-all bg-gold-soft text-primary font-bold rounded-lg text-[13px] shadow-sm whitespace-nowrap inline-flex items-center leading-normal"
                  : "px-3.5 py-1.5 text-[13px] font-medium text-on-surface-variant hover:bg-gold-soft/60 hover:text-primary transition-all rounded-lg whitespace-nowrap inline-flex items-center leading-normal"
              }
            >
              3D Estate &amp; Pay
            </NavLink>
            <NavLink
              to="/notices"
              className={({ isActive }) =>
                isActive
                  ? "px-3.5 py-1.5 transition-all bg-gold-soft text-primary font-bold rounded-lg text-[13px] shadow-sm whitespace-nowrap inline-flex items-center leading-normal"
                  : "px-3.5 py-1.5 text-[13px] font-medium text-on-surface-variant hover:bg-gold-soft/60 hover:text-primary transition-all rounded-lg whitespace-nowrap inline-flex items-center leading-normal"
              }
            >
              Notices
            </NavLink>
            <NavLink
              to="/directory"
              className={({ isActive }) =>
                isActive
                  ? "px-3.5 py-1.5 transition-all bg-gold-soft text-primary font-bold rounded-lg text-[13px] shadow-sm whitespace-nowrap inline-flex items-center leading-normal"
                  : "px-3.5 py-1.5 text-[13px] font-medium text-on-surface-variant hover:bg-gold-soft/60 hover:text-primary transition-all rounded-lg whitespace-nowrap inline-flex items-center leading-normal"
              }
            >
              Directory
            </NavLink>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-error-container text-on-error-container shrink-0 whitespace-nowrap border border-error-container/60">
              <span className="material-symbols-outlined text-[15px] text-error">emergency</span>
              <span className="font-label-sm text-[11px] text-error font-semibold whitespace-nowrap">LIFT SOS: 1800-425-001</span>
            </div>

            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-container-low shrink-0 whitespace-nowrap border border-line/60">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse shrink-0"></span>
              <span className="font-label-sm text-[11px] text-ink-soft whitespace-nowrap">Sec Desk: Active</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Page Area */}
      <main className={`flex-1 w-full ${warn ? "pt-28" : "pt-20"} bg-background`}>
        {isDemo && (
          <div className="max-w-[1280px] mx-auto px-gutter pt-3">
            <div className="p-3 rounded-xl bg-gold-soft/70 border border-gold-soft-deep/60 flex items-center justify-between text-body-sm text-ink-soft">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md bg-gold-deep text-white font-code-md text-[11px] font-bold uppercase">
                  Demo Mode
                </span>
                <span>Data persists in this browser (localStorage). Add Firebase keys in <code>.env</code> for cloud sync.</span>
              </div>
              <span className="font-code-md text-[12px] text-primary font-semibold hidden md:inline">
                Admin PIN: 2408
              </span>
            </div>
          </div>
        )}
        {children}
      </main>

      {/* Luxury Estate Minimalist Footer */}
      <footer className="w-full bg-surface border-t border-line py-8 mt-12">
        <div className="max-w-[1280px] mx-auto px-gutter flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
          <div className="flex items-center gap-3">
            <Logo size={28} />
            <span className="font-body-sm text-ink-soft">
              &copy; {new Date().getFullYear()} {settings?.societyName ?? "Housing Society"} &middot; Sovereign UPI Direct Treasury &middot; Zero Gateway Toll
            </span>
          </div>

          <div className="flex items-center gap-4 text-body-sm text-ink-soft">
            <NavLink to="/" className="hover:text-primary transition-colors">
              3D Estate &amp; Pay
            </NavLink>
            <span>&bull;</span>
            <NavLink to="/directory" className="hover:text-primary transition-colors">
              Directory
            </NavLink>
            <span>&bull;</span>
            <NavLink to="/notices" className="hover:text-primary transition-colors">
              Notices
            </NavLink>
            <span>&bull;</span>
            <NavLink to="/admin" className="hover:text-primary font-semibold transition-colors">
              Committee Desk (PIN 2408)
            </NavLink>
          </div>
        </div>
      </footer>
    </div>
  );
}
