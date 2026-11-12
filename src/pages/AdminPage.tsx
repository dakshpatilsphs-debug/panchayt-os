import { useEffect, useMemo, useState } from "react";
import { useToast } from "../components/Toast";
import { isDemo } from "../lib/firebase";
import { listMembers, listPayments, loadSettings, saveSettings } from "../lib/store";
import type { Member, Payment, SocietySettings } from "../lib/types";
import { inr } from "../lib/util";
import { AdminProvider } from "./admin/AdminCtx";
import PaymentsTab from "./admin/PaymentsTab";
import MembersTab from "./admin/MembersTab";
import NoticesTab from "./admin/NoticesTab";
import ArchiveTab from "./admin/ArchiveTab";
import SettingsTab from "./admin/SettingsTab";

type AdminTab = "payments" | "members" | "notices" | "archive" | "settings";

const ADMIN_AUTH_KEY = "sk.admin_authed";

export default function AdminPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<SocietySettings | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [currentTab, setCurrentTab] = useState<AdminTab>("payments");

  // Admin PIN Gate with persistent session across reloads
  const [authed, setAuthed] = useState<boolean>(() => {
    try {
      return (
        sessionStorage.getItem(ADMIN_AUTH_KEY) === "true" ||
        localStorage.getItem(ADMIN_AUTH_KEY) === "true"
      );
    } catch {
      return false;
    }
  });
  const [pinInput, setPinInput] = useState("2408");
  const [pinError, setPinError] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([loadSettings(), listMembers(), listPayments()])
      .then(([s, ms, ps]) => {
        if (!alive) return;
        setSettings(s);
        setMembers(ms);
        setPayments(ps);
        if (!pinInput) {
          setPinInput(s.adminPin || "2408");
        }
      })
      .catch((e) => toast((e as Error).message, "err"));
    return () => {
      alive = false;
    };
  }, []);

  const handlePinSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const correctPin = settings?.adminPin || "2408";
    if (pinInput.trim() === correctPin) {
      setAuthed(true);
      try {
        sessionStorage.setItem(ADMIN_AUTH_KEY, "true");
        localStorage.setItem(ADMIN_AUTH_KEY, "true");
      } catch {}
      setPinError("");
      toast("Admin authenticated.", "ok");
    } else {
      setPinError("Incorrect 4-digit PIN. Default is 2408.");
      setPinInput("");
    }
  };

  const handleLogout = () => {
    setAuthed(false);
    try {
      sessionStorage.removeItem(ADMIN_AUTH_KEY);
      localStorage.removeItem(ADMIN_AUTH_KEY);
    } catch {}
    toast("Logged out of Committee Desk.", "info");
  };

  const commitSettings = async (s: SocietySettings) => {
    await saveSettings(s);
    setSettings(s);
  };

  // KPIs
  const kpi = useMemo(() => {
    const ms = members ?? [];
    const ps = payments ?? [];
    const thisMonth = new Date().toISOString().slice(0, 7);
    const verifiedThisMonth = ps.filter((p) => p.status === "verified");
    const totalCollected = verifiedThisMonth.reduce((acc, p) => acc + (p.amount || 0), 0);
    const pendingDues = ms.reduce((acc, m) => acc + (m.dueBalance || 0), 0);
    const inArrears = ms.filter((m) => m.dueBalance > 0).length;
    const pendingDrafts = ps.filter((p) => p.status === "pending");
    const pendingSum = pendingDrafts.reduce((acc, p) => acc + (p.amount || 0), 0);

    return {
      totalCollected,
      pendingDues,
      inArrears,
      pendingDraftsCount: pendingDrafts.length,
      pendingSum,
      totalUnits: ms.length,
    };
  }, [members, payments]);

  if (!settings) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-12 h-12 rounded-full bg-gold-soft flex items-center justify-center text-primary mb-4 animate-spin">
          <span className="material-symbols-outlined text-[28px]">sync</span>
        </div>
        <p className="text-ink-soft text-body-sm font-medium">Opening committee desk&hellip;</p>
      </div>
    );
  }

  // PIN Gate Screen
  if (!authed) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-gutter py-12">
        <div className="w-full max-w-md bg-surface rounded-3xl p-8 sm:p-10 shadow-2xl border border-line flex flex-col items-center text-center animate-popIn">
          <div className="w-16 h-16 rounded-2xl bg-gold-soft text-primary flex items-center justify-center shadow-sm mb-4">
            <span className="material-symbols-outlined text-[36px]">admin_panel_settings</span>
          </div>

          <span className="font-label-sm text-label-sm uppercase tracking-widest text-primary font-bold">
            Executive Access
          </span>
          <h2 className="font-headline-md text-headline-md text-on-surface mt-1">
            Committee Admin Desk
          </h2>
          <p className="font-body-md text-body-md text-ink-soft mt-1.5 mb-6">
            Enter the 4-digit committee security PIN to manage flats, verify UPI payments, and edit society records.
          </p>

          <form onSubmit={handlePinSubmit} className="w-full flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2">
              <input
                type="password"
                maxLength={8}
                autoFocus
                inputMode="numeric"
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value);
                  setPinError("");
                }}
                placeholder="PIN"
                className="w-48 text-center text-2xl tracking-[0.3em] font-code-md font-bold py-3 px-4 rounded-xl bg-surface-container-low border border-line focus:ring-2 focus:ring-primary outline-none shadow-inner"
              />
              <button
                type="button"
                onClick={() => {
                  setPinInput(settings?.adminPin || "2408");
                  setPinError("");
                }}
                className="text-[12px] text-primary hover:underline font-semibold cursor-pointer"
              >
                Insert Default PIN ({settings?.adminPin || "2408"})
              </button>
            </div>

            {pinError && (
              <p className="text-body-sm text-error font-medium flex items-center justify-center gap-1">
                <span className="material-symbols-outlined text-[16px]">error</span>
                <span>{pinError}</span>
              </p>
            )}

            <button
              type="submit"
              className="w-full py-3.5 rounded-xl bg-primary hover:bg-gold-deep text-on-primary font-label-md text-label-md font-semibold shadow-md hover:shadow-lg transition-all cursor-pointer mt-2"
            >
              Enter Committee Desk
            </button>
          </form>

          <span className="font-code-md text-[11px] text-muted mt-6">
            Default Demo PIN: <strong>2408</strong> &bull; Changeable in Settings
          </span>
        </div>
      </div>
    );
  }

  return (
    <AdminProvider value={{ settings, commit: commitSettings }}>
      <div className="w-full max-w-[1280px] mx-auto px-gutter py-6 pb-20 flex flex-col gap-6">
        {/* Top Ambient Glow & Section Header */}
        <div className="relative w-full flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-4 border-b border-line/60">
          <div className="flex flex-col space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full bg-gold-soft text-primary font-label-sm text-label-sm tracking-wider uppercase font-semibold">
                Executive Portal
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-surface-container-low text-ink-soft font-code-md text-body-sm border border-line/60">
                <span className="w-2 h-2 rounded-full bg-success"></span>
                {isDemo ? "Local Session: Demo Active" : "Firestore Sync: Cloud Active"}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-surface-container-high text-on-surface font-code-md text-[11px]">
                PIN Authenticated
              </span>
            </div>
            <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">
              Committee Admin Desk
            </h1>
            <p className="font-body-md text-body-md text-ink-soft">
              Treasurer &amp; Secretary Desk for {settings.societyName} &bull; Reg. {settings.regNo}
            </p>
          </div>

          <div className="flex items-center gap-2 self-start lg:self-end">
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-surface text-ink-soft hover:text-error hover:bg-error-container/20 font-label-md text-label-md shadow-sm transition-all border border-line cursor-pointer"
              title="Lock Admin Session"
            >
              <span className="material-symbols-outlined text-[18px]">lock</span>
              <span>Lock Desk</span>
            </button>
            <button
              type="button"
              onClick={() => setCurrentTab("payments")}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface text-on-surface font-label-md text-label-md shadow-sm hover:shadow hover:bg-gold-soft transition-all border border-line cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px] text-primary">fact_check</span>
              <span>Verify Slips</span>
            </button>
            <button
              type="button"
              onClick={() => setCurrentTab("archive")}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary font-label-md text-label-md shadow-sm hover:bg-gold-deep transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              <span>Export Audit Pack</span>
            </button>
          </div>
        </div>

        {/* Bento KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* KPI 1: Total Collected */}
          <div className="p-5 rounded-2xl bg-surface shadow-sm border border-line flex flex-col justify-between relative overflow-hidden group hover:shadow-md transition-all">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-ink-soft">
                Total Collections
              </span>
              <span className="p-2 rounded-xl bg-gold-soft text-primary">
                <span className="material-symbols-outlined text-[20px]">account_balance_wallet</span>
              </span>
            </div>
            <div className="mt-3 flex flex-col">
              <span className="font-headline-lg text-headline-sm sm:text-headline-lg text-on-surface font-semibold tracking-tight">
                {inr(kpi.totalCollected)}
              </span>
              <div className="mt-2 flex items-center justify-between text-body-sm font-body-sm text-ink-soft">
                <span className="text-success font-medium flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">verified</span> Verified Funds
                </span>
                <span className="font-code-md text-[11px]">Zero gateway cut</span>
              </div>
            </div>
          </div>

          {/* KPI 2: Pending Society Dues */}
          <div className="p-5 rounded-2xl bg-surface shadow-sm border border-line flex flex-col justify-between relative overflow-hidden group hover:shadow-md transition-all">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-ink-soft">
                Pending Society Dues
              </span>
              <span className="p-2 rounded-xl bg-error-container text-error">
                <span className="material-symbols-outlined text-[20px]">pending_actions</span>
              </span>
            </div>
            <div className="mt-3 flex flex-col">
              <span className="font-headline-lg text-headline-sm sm:text-headline-lg text-warning font-semibold tracking-tight">
                {inr(kpi.pendingDues)}
              </span>
              <div className="mt-2 flex items-center justify-between text-body-sm font-body-sm">
                <span className="text-warning font-medium">{kpi.inArrears} flats in arrears</span>
                <span className="font-code-md text-[11px] text-ink-soft">Current cycle</span>
              </div>
            </div>
          </div>

          {/* KPI 3: Unverified UTR Drafts */}
          <div className="p-5 rounded-2xl bg-surface shadow-sm border border-line flex flex-col justify-between relative overflow-hidden group hover:shadow-md transition-all">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-ink-soft">
                Unverified Slips
              </span>
              <span className="p-2 rounded-xl bg-primary-fixed text-primary font-bold">
                <span className="material-symbols-outlined text-[20px]">mark_email_unread</span>
              </span>
            </div>
            <div className="mt-3 flex flex-col">
              <span className="font-headline-lg text-headline-sm sm:text-headline-lg text-primary font-semibold tracking-tight">
                {kpi.pendingDraftsCount} payments
              </span>
              <div className="mt-2 flex items-center justify-between text-body-sm font-body-sm">
                <span className="text-primary font-medium">{inr(kpi.pendingSum)} in queue</span>
                <span className="font-code-md text-[11px] text-muted">Awaiting check</span>
              </div>
            </div>
          </div>

          {/* KPI 4: Active Flats */}
          <div className="p-5 rounded-2xl bg-surface shadow-sm border border-line flex flex-col justify-between relative overflow-hidden group hover:shadow-md transition-all">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-ink-soft">
                Active Society Units
              </span>
              <span className="p-2 rounded-xl bg-surface-container-high text-on-surface">
                <span className="material-symbols-outlined text-[20px]">apartment</span>
              </span>
            </div>
            <div className="mt-3 flex flex-col">
              <span className="font-headline-lg text-headline-sm sm:text-headline-lg text-on-surface font-semibold tracking-tight">
                {kpi.totalUnits} Units
              </span>
              <div className="mt-2 flex items-center justify-between text-body-sm font-body-sm">
                <span className="text-ink-soft">Wings: {settings.wings.join(", ")}</span>
                <span className="text-success font-code-md text-[11px]">Onboarded</span>
              </div>
            </div>
          </div>
        </div>

        {/* Editorial Navigation Tabs Bar */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none border-b border-line/60">
          <button
            type="button"
            onClick={() => setCurrentTab("payments")}
            className={`px-5 py-2.5 rounded-full font-label-md text-label-md flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
              currentTab === "payments"
                ? "bg-primary text-on-primary font-semibold shadow-sm"
                : "bg-surface text-ink-soft hover:bg-gold-soft hover:text-primary border border-line"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">fact_check</span>
            <span>Payment Verification</span>
            {kpi.pendingDraftsCount > 0 && (
              <span
                className={`ml-1 px-2 py-0.5 rounded-full font-code-md text-[11px] font-bold ${
                  currentTab === "payments"
                    ? "bg-gold-soft text-primary"
                    : "bg-primary text-on-primary"
                }`}
              >
                {kpi.pendingDraftsCount} Pending
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setCurrentTab("members")}
            className={`px-5 py-2.5 rounded-full font-label-md text-label-md flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
              currentTab === "members"
                ? "bg-primary text-on-primary font-semibold shadow-sm"
                : "bg-surface text-ink-soft hover:bg-gold-soft hover:text-primary border border-line"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">menu_book</span>
            <span>Member Ledger &amp; Flats Directory</span>
          </button>

          <button
            type="button"
            onClick={() => setCurrentTab("notices")}
            className={`px-5 py-2.5 rounded-full font-label-md text-label-md flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
              currentTab === "notices"
                ? "bg-primary text-on-primary font-semibold shadow-sm"
                : "bg-surface text-ink-soft hover:bg-gold-soft hover:text-primary border border-line"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">campaign</span>
            <span>Notice Composer</span>
          </button>

          <button
            type="button"
            onClick={() => setCurrentTab("archive")}
            className={`px-5 py-2.5 rounded-full font-label-md text-label-md flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
              currentTab === "archive"
                ? "bg-primary text-on-primary font-semibold shadow-sm"
                : "bg-surface text-ink-soft hover:bg-gold-soft hover:text-primary border border-line"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">inventory_2</span>
            <span>Excel Archive &amp; Audit</span>
          </button>

          <button
            type="button"
            onClick={() => setCurrentTab("settings")}
            className={`px-5 py-2.5 rounded-full font-label-md text-label-md flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
              currentTab === "settings"
                ? "bg-primary text-on-primary font-semibold shadow-sm"
                : "bg-surface text-ink-soft hover:bg-gold-soft hover:text-primary border border-line"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">qr_code_2</span>
            <span>Society Settings &amp; UPI</span>
          </button>
        </div>

        {/* Tab Content Display */}
        <div className="w-full bg-surface rounded-2xl p-5 sm:p-7 shadow-sm border border-line animate-fadeIn">
          {currentTab === "payments" && <PaymentsTab />}
          {currentTab === "members" && <MembersTab />}
          {currentTab === "notices" && <NoticesTab />}
          {currentTab === "archive" && <ArchiveTab />}
          {currentTab === "settings" && <SettingsTab />}
        </div>
      </div>
    </AdminProvider>
  );
}
