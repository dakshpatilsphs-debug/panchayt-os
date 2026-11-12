import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../components/Toast";
import { listMembers, listNotices, loadSettings } from "../lib/store";
import type { Member, Notice, SocietySettings } from "../lib/types";

export default function NoticesPage() {
  const { toast } = useToast();
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [settings, setSettings] = useState<SocietySettings | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "info" | "warn" | "event">("all");

  useEffect(() => {
    let alive = true;
    Promise.all([listNotices(), listMembers(), loadSettings()])
      .then(([ns, ms, s]) => {
        if (!alive) return;
        setNotices(ns);
        setMembers(ms);
        setSettings(s);
      })
      .catch((e) => toast(e.message, "err"));
    return () => {
      alive = false;
    };
  }, []);

  const filteredNotices = useMemo(() => {
    if (!notices) return [];
    const q = query.trim().toLowerCase();
    return notices
      .filter((n) => {
        if (filter !== "all" && n.tone !== filter) return false;
        if (!q) return true;
        return (
          n.title.toLowerCase().includes(q) ||
          n.body.toLowerCase().includes(q) ||
          (n.targetWing && n.targetWing.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [notices, query, filter]);

  const pinnedNotice = useMemo(() => filteredNotices.find((n) => n.pinned), [filteredNotices]);
  const regularNotices = useMemo(
    () => (pinnedNotice ? filteredNotices.filter((n) => n.id !== pinnedNotice.id) : filteredNotices),
    [filteredNotices, pinnedNotice]
  );

  const shareNotice = (n: Notice) => {
    const text = `${n.title}\n\n${n.body}\n\n— ${settings?.societyName || "Society Management"}`;
    if (navigator.share) {
      navigator.share({ title: n.title, text }).catch(() => undefined);
    } else {
      navigator.clipboard?.writeText(text);
      toast("Notice text copied to clipboard.", "info");
    }
  };

  if (!notices || !settings) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-12 h-12 rounded-full bg-gold-soft flex items-center justify-center text-primary mb-4 animate-spin">
          <span className="material-symbols-outlined text-[28px]">sync</span>
        </div>
        <p className="text-ink-soft text-body-sm font-medium">Reading the society board&hellip;</p>
      </div>
    );
  }

  return (
    <div className="relative w-full max-w-[1280px] mx-auto px-gutter py-8 pb-16 flex flex-col gap-6">
      {/* Editorial Masthead Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 bg-surface p-6 sm:p-8 rounded-2xl shadow-sm border border-line relative overflow-hidden">
        <div className="absolute -right-16 -top-16 w-80 h-80 rounded-full bg-gold-soft opacity-60 pointer-events-none blur-3xl"></div>
        <div className="relative z-10 flex flex-col gap-1 max-w-2xl">
          <div className="flex items-center gap-2 text-primary">
            <span className="material-symbols-outlined text-[20px]">campaign</span>
            <span className="font-label-sm text-label-sm uppercase tracking-widest text-primary font-semibold">
              Official Gazette &bull; {settings.societyName}
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight mt-1">
            Society Gazette &amp; Notices
          </h1>
          <p className="font-body-lg text-body-lg text-ink-soft mt-1">
            Official circulars, general body resolutions, infrastructure maintenance schedules, and civic announcements.
          </p>
        </div>

        <div className="relative z-10 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
          <div className="px-4 py-2.5 bg-surface-container-low rounded-xl flex items-center gap-3 border border-line/60">
            <div className="w-2.5 h-2.5 rounded-full bg-success animate-pulse shrink-0"></div>
            <div className="flex flex-col">
              <span className="font-label-sm text-label-sm text-ink-soft uppercase">Registered Units</span>
              <span className="font-code-md text-code-md font-semibold text-on-surface">
                {members?.length || 0} Flats
              </span>
            </div>
          </div>
          <Link
            to="/admin"
            className="px-4 py-2.5 bg-gold-soft hover:bg-gold-soft-deep/60 text-primary font-label-md text-label-md font-semibold rounded-xl flex items-center gap-2 border border-gold-soft-deep/60 transition-colors shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">add_circle</span>
            <span>Publish Notice</span>
          </Link>
        </div>
      </div>

      {/* Filter and Search Matrix */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-surface p-3 rounded-2xl border border-line shadow-sm">
        {/* Search Input */}
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-muted text-[20px] pointer-events-none">
            search
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search circulars, resolutions, or keywords (e.g. Water, AGM, Lift)..."
            className="w-full bg-surface-container-low text-on-surface placeholder:text-muted pl-12 pr-4 py-3 rounded-xl font-body-md text-body-md outline-none border border-transparent focus:border-line focus:bg-surface transition-all"
          />
        </div>

        {/* Category Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0 scrollbar-none">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`px-4 py-2.5 rounded-xl font-label-md text-label-md whitespace-nowrap transition-all cursor-pointer ${
              filter === "all"
                ? "bg-primary text-on-primary font-semibold shadow-sm"
                : "bg-surface-container-low text-ink-soft hover:bg-gold-soft hover:text-primary"
            }`}
          >
            All ({notices.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("info")}
            className={`px-4 py-2.5 rounded-xl font-label-md text-label-md whitespace-nowrap transition-all cursor-pointer ${
              filter === "info"
                ? "bg-primary text-on-primary font-semibold shadow-sm"
                : "bg-surface-container-low text-ink-soft hover:bg-gold-soft hover:text-primary"
            }`}
          >
            General &bull; Info ({notices.filter((n) => n.tone === "info" || !n.tone).length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("warn")}
            className={`px-4 py-2.5 rounded-xl font-label-md text-label-md whitespace-nowrap transition-all cursor-pointer ${
              filter === "warn"
                ? "bg-primary text-on-primary font-semibold shadow-sm"
                : "bg-surface-container-low text-ink-soft hover:bg-gold-soft hover:text-primary"
            }`}
          >
            Urgent &bull; Alerts ({notices.filter((n) => n.tone === "warn").length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("event")}
            className={`px-4 py-2.5 rounded-xl font-label-md text-label-md whitespace-nowrap transition-all cursor-pointer ${
              filter === "event"
                ? "bg-primary text-on-primary font-semibold shadow-sm"
                : "bg-surface-container-low text-ink-soft hover:bg-gold-soft hover:text-primary"
            }`}
          >
            Events &bull; AGM ({notices.filter((n) => n.tone === "event").length})
          </button>
        </div>
      </div>

      {/* Active Pinned Notice (Gold Highlighted Card) */}
      {pinnedNotice && (
        <div className="relative bg-surface rounded-2xl shadow-md border border-primary/40 overflow-hidden animate-fadeIn">
          {/* Champagne accent ribbon top bar */}
          <div className="h-2 w-full bg-gradient-to-r from-primary via-gold-light to-primary"></div>
          <div className="p-6 sm:p-8 flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-line/60">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-3 py-1 bg-gold-soft text-primary font-label-sm text-label-sm uppercase tracking-wider rounded-full flex items-center gap-1 font-semibold">
                  <span className="material-symbols-outlined text-[15px]">push_pin</span>
                  Pinned Bulletin
                </span>
                <span className="px-3 py-1 bg-surface-container-low text-ink-soft font-code-md text-[12px] rounded-full">
                  {new Date(pinnedNotice.createdAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                {pinnedNotice.targetType && pinnedNotice.targetType !== "all" && (
                  <span className="px-2.5 py-0.5 rounded-full bg-gold-soft text-primary font-code-md text-[11px] font-semibold">
                    Target: {pinnedNotice.targetType.toUpperCase()}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => shareNotice(pinnedNotice)}
                className="self-start sm:self-center px-3.5 py-1.5 rounded-lg bg-surface hover:bg-gold-soft text-primary font-label-md text-[12px] font-semibold border border-line shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">share</span>
                <span>Share Circular</span>
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <h2 className="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
                {pinnedNotice.title}
              </h2>
              <p className="font-body-lg text-body-lg text-ink-soft leading-relaxed whitespace-pre-line">
                {pinnedNotice.body}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Notices Grid */}
      {filteredNotices.length === 0 ? (
        <div className="bg-surface rounded-2xl p-12 text-center border border-line shadow-sm">
          <span className="material-symbols-outlined text-[48px] text-muted mb-2">inbox</span>
          <h3 className="font-title-lg text-title-lg text-on-surface">No circulars found</h3>
          <p className="font-body-sm text-muted mt-1">There are no notices matching your filter or search keywords.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {regularNotices.map((n) => (
            <div
              key={n.id}
              className={`bg-surface rounded-2xl p-6 shadow-sm border flex flex-col justify-between gap-4 transition-all hover:-translate-y-0.5 ${
                n.tone === "warn"
                  ? "border-warning/40 bg-warning/5"
                  : n.tone === "event"
                  ? "border-primary/40 bg-gold-soft/20"
                  : "border-line"
              }`}
            >
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-0.5 rounded-full font-label-sm text-[11px] uppercase font-bold tracking-wider ${
                        n.tone === "warn"
                          ? "bg-warning/15 text-warning"
                          : n.tone === "event"
                          ? "bg-primary/15 text-primary"
                          : "bg-surface-container-low text-ink-soft"
                      }`}
                    >
                      {n.tone?.toUpperCase() || "ANNOUNCEMENT"}
                    </span>
                    {n.targetType && n.targetType !== "all" && (
                      <span className="font-code-md text-[11px] text-primary bg-gold-soft px-2 py-0.5 rounded font-semibold">
                        {n.targetType.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <span className="font-code-md text-[12px] text-muted">
                    {new Date(n.createdAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </div>

                <h3 className="font-title-lg text-title-lg text-on-surface font-semibold leading-snug">
                  {n.title}
                </h3>
                <p className="font-body-md text-body-md text-ink-soft leading-relaxed whitespace-pre-line">
                  {n.body}
                </p>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-line/60">
                <span className="font-label-sm text-[11px] text-muted uppercase">
                  Issued by Society Office
                </span>
                <button
                  type="button"
                  onClick={() => shareNotice(n)}
                  className="p-2 rounded-lg bg-surface hover:bg-gold-soft text-ink-soft hover:text-primary transition-colors border border-line cursor-pointer"
                  title="Share notice"
                >
                  <span className="material-symbols-outlined text-[16px]">share</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
