import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import UpiQr from "../components/UpiQr";
import ThreeBuilding from "../components/ThreeBuilding";
import { useToast } from "../components/Toast";
import { checkStorageAlert } from "../lib/email";
import { readPaymentScreenshot } from "../lib/shot";
import {
  createPayment,
  deletePayment,
  listContacts,
  listMembers,
  listNotices,
  loadSettings,
  updatePayment,
} from "../lib/store";
import type { Contact, Member, Notice, Payment, ScreenshotMeta, SocietySettings } from "../lib/types";
import { buildUpiUri, floorLabel, getFlatFloor, inr, newPaymentId, utrLooksValid } from "../lib/util";

type Step = 1 | 2 | 3 | 4;

const getTodayDateStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function PayPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [settings, setSettings] = useState<SocietySettings | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);

  // Slide deck step state: 1 = Flat, 2 = Amount, 3 = UPI & Screenshot, 4 = Done
  const [step, setStep] = useState<Step>(1);

  const [wing, setWing] = useState(() => searchParams.get("wing") || "");
  const [flat, setFlat] = useState(() => searchParams.get("flat") || "");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(getTodayDateStr);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [utr, setUtr] = useState("");
  const [payNote, setPayNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [utrError, setUtrError] = useState("");
  const [show3D, setShow3D] = useState(true);

  const [shotUrl, setShotUrl] = useState("");
  const [shotMeta, setShotMeta] = useState<ScreenshotMeta | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrPct, setOcrPct] = useState(0);
  const [ocrHint, setOcrHint] = useState("");

  const paymentRef = useRef<Payment | null>(null);
  const startLock = useRef(false);
  const deckRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolled = useRef(false);

  useEffect(() => {
    paymentRef.current = payment;
  }, [payment]);

  useEffect(() => {
    try {
      localStorage.removeItem("sk.session");
    } catch {}
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([listMembers(), loadSettings(), listNotices(), listContacts()])
      .then(([ms, s, ns, cs]) => {
        if (!alive) return;
        setMembers(ms);
        setSettings(s);
        setNotices(ns);
        setContacts(cs);
      })
      .catch((e) => toast(e.message, "err"));
    return () => {
      alive = false;
    };
  }, []);

  // One-time auto-scroll on opening to take the user directly to the flat selection
  useEffect(() => {
    if (members && members.length > 0 && !hasAutoScrolled.current) {
      hasAutoScrolled.current = true;
      const timer = setTimeout(() => {
        const el = deckRef.current;
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [members]);

  const wings = useMemo(
    () => Array.from(new Set((members ?? []).filter((m) => m.active).map((m) => m.wing))).sort(),
    [members]
  );

  useEffect(() => {
    if (!wing && wings.length > 0) setWing(wings[0]);
  }, [wings, wing]);

  const me = useMemo(() => {
    const ms = members ?? [];
    if (wing && flat) return ms.find((m) => m.wing === wing && m.flat === flat) ?? null;
    return null;
  }, [members, wing, flat]);

  const flats = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.wing === wing && m.active)
        .sort((a, b) => a.flat.localeCompare(b.flat, "en", { numeric: true })),
    [members, wing]
  );

  const floorFlats = useMemo(() => {
    const groups = new Map<number, Member[]>();
    for (const m of flats) {
      const f = getFlatFloor(m.flat, m.floor);
      if (!groups.has(f)) groups.set(f, []);
      groups.get(f)!.push(m);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }, [flats]);

  const amountN = Math.round(Number(amount) * 100) / 100;
  const amountValid = Number.isFinite(amountN) && amountN > 0 && amountN <= 500000;
  const dateValid = Boolean(paymentDate) && paymentDate <= getTodayDateStr();

  // Slide deck step transitions:
  const pickFlat = (m: Member) => {
    setWing(m.wing);
    setFlat(m.flat);
    setPayment(null);
    setUtr("");
    setAmount("");
    setShotUrl("");
    setShotMeta(null);
    setOcrHint("");
    // Slide deck transition: Advance to Step 2
    setStep(2);
    deckRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const resetToStep1 = () => {
    setStep(1);
    setPayment(null);
    setUtr("");
    setAmount("");
    setPayNote("");
    setShotUrl("");
    setShotMeta(null);
    setOcrBusy(false);
    setOcrPct(0);
    setOcrHint("");
    deckRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const buildDraft = async (): Promise<Payment> => {
    if (!me) throw new Error("Pick your flat first");
    const p: Payment = {
      id: newPaymentId(),
      memberId: me.id,
      wing: me.wing,
      flat: me.flat,
      ownerName: me.ownerName,
      month: paymentDate.slice(0, 7),
      amount: amountN,
      maintenancePart: amountN,
      donationPart: 0,
      method: "upi",
      utr: "",
      status: "pending",
      createdAt: new Date(`${paymentDate}T${new Date().toTimeString().slice(0, 8)}`).toISOString(),
      note: "",
    };
    const saved = await createPayment(p);
    checkStorageAlert().catch(() => undefined);
    return saved as Payment;
  };

  const proceedToStep3 = async () => {
    if (!me || !amountValid || !dateValid || startLock.current || busy) return;
    startLock.current = true;
    setBusy(true);
    try {
      const saved = await buildDraft();
      setPayment(saved);
      // Slide deck transition: Advance to Step 3
      setStep(3);
      deckRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      setPayment(null);
      toast(
        (e as Error).message.includes("permission")
          ? (e as Error).message
          : "Network hiccup while opening the payment — try again.",
        "err"
      );
    } finally {
      startLock.current = false;
      setBusy(false);
    }
  };

  const handleShot = async (file: File | undefined) => {
    const draft = paymentRef.current;
    if (!draft || ocrBusy || !file) return;
    if (!file.type.startsWith("image/")) {
      setOcrHint("That's not an image — screenshots from your UPI app work best.");
      return;
    }
    setOcrBusy(true);
    setOcrPct(0);
    setOcrHint("");
    try {
      const read = await readPaymentScreenshot(file, draft.amount, (pct) => setOcrPct(pct));
      const meta: ScreenshotMeta = {
        attachedAt: new Date().toISOString(),
        verdict: read.verdict,
        ...(read.utr ? { ocrUtr: read.utr } : {}),
        ...(read.amount != null && !Number.isNaN(read.amount) ? { ocrAmount: read.amount } : {}),
      };
      if (paymentRef.current?.id !== draft.id) return;
      const patch: { screenshotMeta: ScreenshotMeta; utr?: string } = { screenshotMeta: meta };
      if (read.utr && utrLooksValid(read.utr) && !draft.utr) {
        patch.utr = read.utr;
        setUtr(read.utr);
      }
      await updatePayment(draft.id, patch);
      setShotUrl(read.dataUrl);
      setShotMeta(meta);

      if (!read.utr) {
        setOcrHint(
          read.verdict === "matched"
            ? ""
            : "No 12-digit UTR detected on screenshot — enter it manually below."
        );
      }
      if (read.verdict === "matched") {
        if (!utr && read.utr) setUtr(read.utr);
        toast("Screenshot verified — 12-digit UTR auto-populated.", "ok");
      } else if (read.verdict === "partial" || read.utr) {
        if (!utr && read.utr) setUtr(read.utr);
        toast("Screenshot attached — UTR captured.", "info");
      } else {
        toast("Screenshot attached — please type 12-digit UTR below.", "info");
      }
    } catch (e) {
      setOcrHint((e as Error).message || "Couldn't read screenshot — enter UTR manually below.");
    } finally {
      setOcrBusy(false);
      setOcrPct(0);
    }
  };

  const removeShot = async () => {
    const draft = paymentRef.current;
    if (!draft || ocrBusy) return;
    setShotUrl("");
    setShotMeta(null);
    setOcrHint("");
    try {
      await updatePayment(draft.id, { screenshot: "", screenshotMeta: undefined });
    } catch {}
  };

  const submitUtr = async () => {
    if (!payment || busy || startLock.current) return;
    if (!utrLooksValid(utr)) {
      setUtrError("A UPI UTR is exactly 12 digits — check the reference in your UPI app.");
      return;
    }
    startLock.current = true;
    setBusy(true);
    try {
      await updatePayment(payment.id, { utr: utr.trim(), note: payNote.trim() });
      setPayment({ ...payment, utr: utr.trim() });
      // Slide deck transition: Advance to Step 4 (Done)
      setStep(4);
      toast("Payment submitted — awaiting committee verification.", "ok");
      deckRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      toast("Couldn't reach the server — your reference is kept, try once more.", "err");
    } finally {
      startLock.current = false;
      setBusy(false);
    }
  };

  const cancelPayment = async () => {
    if (!payment) return;
    try {
      await deletePayment(payment.id);
    } catch {}
    toast("Draft payment discarded.", "info");
    setPayment(null);
    setStep(2);
  };

  if (!members || !settings) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-12 h-12 rounded-full bg-gold-soft flex items-center justify-center text-primary mb-4 animate-spin">
          <span className="material-symbols-outlined text-[28px]">sync</span>
        </div>
        <p className="text-ink-soft text-body-sm font-medium">Opening the society register&hellip;</p>
      </div>
    );
  }

  const upiNote = `${settings.societyName} maint ${me?.wing ?? wing}-${me?.flat ?? flat} ${paymentDate}`;
  const uri = payment
    ? buildUpiUri({
        vpa: settings.upiId,
        payee: settings.payeeName || settings.societyName,
        amount: payment.amount,
        note: upiNote,
      })
    : "";

  const handleOpenGpay = () => {
    if (!payment) return;
    const link = document.createElement("a");
    link.href = `upi://pay?${new URLSearchParams({
      pa: settings.upiId,
      pn: settings.payeeName || settings.societyName,
      am: String(payment.amount),
      cu: "INR",
      tn: upiNote,
    }).toString()}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast("Opening GPay&hellip;", "info");
  };

  const handleOpenPhonePe = () => {
    if (!payment) return;
    const link = document.createElement("a");
    link.href = `upi://pay?${new URLSearchParams({
      pa: settings.upiId,
      pn: settings.payeeName || settings.societyName,
      am: String(payment.amount),
      cu: "INR",
      tn: upiNote,
    }).toString()}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast("Opening PhonePe&hellip;", "info");
  };

  const handleOpenAnyUpi = () => {
    if (!uri) return;
    const link = document.createElement("a");
    link.href = uri;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast("Opening UPI app&hellip;", "info");
  };

  const handleCopyUpiId = () => {
    navigator.clipboard?.writeText(settings.upiId);
    toast("UPI ID copied to clipboard.", "info");
  };

  // Treasury stats
  const clearedCount = members.filter((m) => m.dueBalance <= 0).length;
  const totalCount = members.length || 1;
  const collectionPct = Math.min(100, Math.round((clearedCount / totalCount) * 100));

  return (
    <div className="w-full">
      {/* 3D Society Model Section */}
      <section className="w-full max-w-[1280px] mx-auto px-4 sm:px-gutter pt-space-md sm:pt-space-lg pb-space-xs">
        {/* 3D Model Bar */}
        <div className="flex items-center justify-between py-2 mb-2">
          <div className="flex items-center gap-2 text-label-sm text-ink-soft uppercase font-semibold">
            <span className="material-symbols-outlined text-[18px] text-primary">apartment</span>
            <span className="font-bold text-on-surface">{settings.societyName}</span>
            {settings.regNo && (
              <span className="font-code-md text-ink-soft text-body-sm hidden sm:inline">&bull; Reg. {settings.regNo}</span>
            )}
            <span>&bull;</span>
            <span>3D Society Model</span>
          </div>
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-surface hover:bg-gold-soft text-primary font-label-md text-[12px] border border-line transition-all shadow-sm cursor-pointer"
            onClick={() => setShow3D(!show3D)}
          >
            <span className="material-symbols-outlined text-[16px]">
              {show3D ? "visibility_off" : "visibility"}
            </span>
            <span>{show3D ? "Hide 3D Model" : "Show 3D Model"}</span>
          </button>
        </div>

        {/* Interactive 3D Building Simulation */}
        {show3D && (
          <ThreeBuilding
            societyName={settings.societyName}
            members={members}
            selectedWing={wing}
            selectedFlat={flat}
            onSelectUnit={(w, f) => {
              setWing(w);
              setFlat(f);
              const target = members.find((m) => m.wing === w && m.flat === f);
              if (target) {
                pickFlat(target);
              }
            }}
          />
        )}
      </section>

      {/* Main Workspace: Flat Selection & Slide Deck Flow */}
      <section id="flat-selection-section" className="w-full max-w-[1280px] mx-auto px-4 sm:px-gutter pt-space-md pb-space-xl scroll-mt-20 sm:scroll-mt-24" ref={deckRef}>
        {/* Title Block & Flow Stepper Pill positioned at Flat Selection */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-space-md pb-space-md border-b border-line/60 mb-space-md">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-gold-soft text-primary font-label-sm text-label-sm uppercase tracking-wider font-semibold">
                {settings.societyName}
              </span>
              {settings.regNo && (
                <span className="font-code-md text-ink-soft text-body-sm">Reg. {settings.regNo}</span>
              )}
            </div>
            <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight mt-1">
              Pay Your Maintenance
            </h1>
            <p className="font-body-md text-body-md text-ink-soft">
              Select your flat, confirm your maintenance amount, and pay directly via UPI.
            </p>
          </div>

          {/* Flow Stepper Pill */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 bg-surface p-2 rounded-2xl shadow-sm border border-line">
            <button
              type="button"
              onClick={() => setStep(1)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                step === 1 ? "bg-gold-soft text-primary font-bold shadow-sm" : "text-ink-soft hover:bg-gold-soft/40"
              }`}
            >
              <span className={`w-5 h-5 rounded-full text-[11px] flex items-center justify-center font-bold ${
                step === 1 ? "bg-primary text-on-primary" : step > 1 ? "bg-success text-white" : "bg-surface-variant text-ink-soft"
              }`}>
                {step > 1 ? "✓" : "1"}
              </span>
              <span className="font-label-md text-[13px] whitespace-nowrap">Select Flat</span>
            </button>

            <span className="material-symbols-outlined text-outline text-[16px]">chevron_right</span>

            <button
              type="button"
              disabled={!me}
              onClick={() => me && setStep(2)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all ${
                step === 2
                  ? "bg-gold-soft text-primary font-bold shadow-sm cursor-pointer"
                  : me
                  ? "text-ink-soft hover:bg-gold-soft/40 cursor-pointer"
                  : "text-muted opacity-50 cursor-not-allowed"
              }`}
            >
              <span className={`w-5 h-5 rounded-full text-[11px] flex items-center justify-center font-bold ${
                step === 2 ? "bg-primary text-on-primary" : step > 2 ? "bg-success text-white" : "bg-surface-variant text-ink-soft"
              }`}>
                {step > 2 ? "✓" : "2"}
              </span>
              <span className="font-label-md text-[13px] whitespace-nowrap hidden sm:inline">Amount &amp; Date</span>
            </button>

            <span className="material-symbols-outlined text-outline text-[16px]">chevron_right</span>

            <button
              type="button"
              disabled={!payment}
              onClick={() => payment && setStep(3)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all ${
                step === 3
                  ? "bg-gold-soft text-primary font-bold shadow-sm cursor-pointer"
                  : payment
                  ? "text-ink-soft hover:bg-gold-soft/40 cursor-pointer"
                  : "text-muted opacity-50 cursor-not-allowed"
              }`}
            >
              <span className={`w-5 h-5 rounded-full text-[11px] flex items-center justify-center font-bold ${
                step === 3 ? "bg-primary text-on-primary" : step > 3 ? "bg-success text-white" : "bg-surface-variant text-ink-soft"
              }`}>
                {step > 3 ? "✓" : "3"}
              </span>
              <span className="font-label-md text-[13px] whitespace-nowrap hidden sm:inline">UPI &amp; Screenshot</span>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
          
          {/* Slide Deck Container: 8 Columns */}
          <div className="lg:col-span-8 flex flex-col gap-4">
            
            {/* Slide Deck Card */}
            <div className="bg-surface rounded-2xl p-space-md sm:p-space-lg shadow-md border border-line overflow-hidden transition-all duration-300">
              
              {/* SLIDE 1: Select Flat No */}
              {step === 1 && (
                <div className="flex flex-col gap-5 animate-fadeIn">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-line/60">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full bg-gold-soft text-primary font-label-sm text-[11px] uppercase font-bold tracking-wider">
                          Slide 1 of 3
                        </span>
                        <span className="font-label-sm text-[12px] text-ink-soft">
                          Click any flat to advance
                        </span>
                      </div>
                      <h2 className="font-title-lg text-title-lg text-on-surface mt-1 font-bold">
                        Select Residential Flat
                      </h2>
                    </div>

                    {/* Wing Selection Tabs */}
                    <div className="flex items-center gap-1.5 p-1 bg-surface-container-low rounded-full shrink-0">
                      {wings.map((w) => (
                        <button
                          key={w}
                          type="button"
                          className={`px-4 py-1.5 rounded-full font-label-md text-label-md transition-all cursor-pointer whitespace-nowrap ${
                            wing === w
                              ? "bg-primary text-on-primary font-bold shadow-sm"
                              : "text-on-surface-variant hover:text-on-surface hover:bg-surface/60"
                          }`}
                          onClick={() => {
                            setWing(w);
                            setFlat("");
                          }}
                        >
                          Wing {w}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Floor-by-Floor Flat Matrix */}
                  <div className="flex flex-col gap-4 pt-1">
                    {floorFlats.map(([floorNum, fList]) => (
                      <div key={floorNum} className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="font-label-sm text-label-sm text-ink-soft uppercase font-semibold">
                            {floorLabel(floorNum)}
                          </span>
                          <span className="font-code-md text-[11px] text-muted">
                            {fList.length} {fList.length === 1 ? "unit" : "units"}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                          {fList.map((m) => {
                            const isSelected = wing === m.wing && flat === m.flat;
                            const hasDue = m.dueBalance > 0;
                            return (
                              <button
                                key={m.id}
                                type="button"
                                className={`text-left p-3 rounded-xl transition-all flex flex-col justify-between h-24 border cursor-pointer hover:scale-[1.02] hover:shadow-md ${
                                  isSelected
                                    ? "bg-gold-soft border-primary ring-2 ring-primary shadow-sm"
                                    : "bg-surface-container-low hover:bg-gold-soft/50 border-line/70"
                                }`}
                                onClick={() => pickFlat(m)}
                                title={m.ownerName ? `Owner: ${m.ownerName}` : undefined}
                              >
                                <div className="flex items-center justify-between">
                                  <span className={`font-code-md text-title-md font-bold ${isSelected ? "text-primary" : "text-on-surface"}`}>
                                    {m.wing}-{m.flat}
                                  </span>
                                  <span
                                    className={`w-2.5 h-2.5 rounded-full ${hasDue ? "bg-warning" : "bg-success"}`}
                                    title={hasDue ? `₹${m.dueBalance} due` : "Account clear"}
                                  />
                                </div>
                                <div className="flex flex-col overflow-hidden">
                                  <span className="font-body-sm text-[12px] text-ink-soft truncate font-medium">
                                    {m.ownerName || "— No owner recorded"}
                                  </span>
                                  {hasDue ? (
                                    <span className="font-code-md text-[12px] text-warning font-semibold">
                                      ₹{m.dueBalance.toLocaleString("en-IN")} due
                                    </span>
                                  ) : (
                                    <span className="font-code-md text-[11px] text-success font-medium">
                                      Settled (Clear)
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SLIDE 2: Maintenance Amount & Payment Date */}
              {step === 2 && me && (
                <div className="flex flex-col gap-5 animate-fadeIn">
                  {/* Step Navigation Bar */}
                  <div className="flex items-center justify-between pb-3 border-b border-line/60">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="inline-flex items-center gap-1.5 text-primary hover:text-gold-deep font-label-md text-[13px] font-bold cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                      <span>Back to Flat Selection</span>
                    </button>

                    <span className="px-2.5 py-0.5 rounded-full bg-gold-soft text-primary font-label-sm text-[11px] uppercase font-bold tracking-wider">
                      Slide 2 of 3 &bull; Amount
                    </span>
                  </div>

                  {/* Selected Unit Profile Banner */}
                  <div className="p-4 rounded-xl bg-surface-container-low flex flex-wrap items-center justify-between gap-4 border border-line/60">
                    <div className="flex items-center gap-3">
                      <div className="w-13 h-13 rounded-xl bg-gold-soft text-primary flex items-center justify-center font-code-md font-bold text-headline-sm shadow-sm">
                        <span>{me.flat}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-title-md text-title-md font-bold text-on-surface">
                            {me.ownerName || "Resident Member"}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-gold-soft text-primary font-label-sm text-[10px] uppercase font-bold">
                            Wing {me.wing}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 font-body-sm text-ink-soft text-[12px] mt-0.5">
                          <span>Floor: <strong>{floorLabel(getFlatFloor(me.flat, me.floor))}</strong></span>
                          {me.phone && (
                            <>
                              <span>&bull;</span>
                              <span className="font-code-md">{me.phone}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="font-label-sm text-label-sm text-ink-soft uppercase tracking-wider block">
                        Ledger Status
                      </span>
                      <span className={`font-headline-sm text-headline-sm font-bold tabular-nums ${me.dueBalance > 0 ? "text-warning" : "text-success"}`}>
                        {me.dueBalance > 0 ? `₹${me.dueBalance.toLocaleString("en-IN")} Due` : "Settled (Clear)"}
                      </span>
                    </div>
                  </div>

                  {/* Maintenance Settlement Form */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      proceedToStep3();
                    }}
                    className="flex flex-col gap-5 pt-2"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Amount Input */}
                      <div className="flex flex-col gap-1.5">
                        <label className="font-label-sm text-label-sm text-ink-soft uppercase tracking-wider font-semibold">
                          Maintenance Amount (₹)
                        </label>
                        <div className="relative">
                          <span className="absolute left-3.5 top-3 font-code-md font-bold text-ink-soft text-[18px]">₹</span>
                          <input
                            type="number"
                            min="1"
                            max="500000"
                            step="any"
                            required
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="Enter amount"
                            className="w-full pl-9 pr-3 py-3 rounded-xl bg-surface-soft font-code-md text-headline-sm font-bold text-on-surface outline-none border border-line focus:ring-2 focus:ring-primary shadow-sm tabular-nums"
                          />
                        </div>

                        {/* Quick Presets */}
                        <div className="flex items-center gap-2 mt-1">
                          {me.monthlyMaintenance > 0 && (
                            <button
                              type="button"
                              onClick={() => setAmount(String(me.monthlyMaintenance))}
                              className="px-2.5 py-1 rounded-lg bg-surface-container-low hover:bg-gold-soft text-primary font-code-md text-[11px] font-semibold border border-line transition-colors cursor-pointer"
                            >
                              Monthly: ₹{me.monthlyMaintenance}
                            </button>
                          )}
                          {me.dueBalance > 0 && (
                            <button
                              type="button"
                              onClick={() => setAmount(String(me.dueBalance))}
                              className="px-2.5 py-1 rounded-lg bg-warning/10 hover:bg-warning/20 text-warning font-code-md text-[11px] font-semibold border border-warning/30 transition-colors cursor-pointer"
                            >
                              Clear Full Due: ₹{me.dueBalance}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Payment Date Input */}
                      <div className="flex flex-col gap-1.5">
                        <label className="font-label-sm text-label-sm text-ink-soft uppercase tracking-wider font-semibold">
                          Payment Date (Defaults to Today)
                        </label>
                        <input
                          type="date"
                          max={getTodayDateStr()}
                          value={paymentDate}
                          onChange={(e) => setPaymentDate(e.target.value)}
                          required
                          className="w-full px-3.5 py-3 rounded-xl bg-surface-soft font-code-md text-title-md text-on-surface outline-none border border-line shadow-sm"
                        />
                        <span className="font-body-sm text-ink-soft text-[11px]">
                          Official date stamped on the society register
                        </span>
                      </div>
                    </div>

                    {/* Bottom Action Row */}
                    <div className="flex items-center justify-between pt-4 border-t border-line/60">
                      <button
                        type="button"
                        onClick={() => setStep(1)}
                        className="px-5 py-3 rounded-xl bg-surface-container-low hover:bg-surface text-ink-soft font-label-md text-[13px] font-semibold border border-line transition-all cursor-pointer"
                      >
                        ← Back
                      </button>

                      <button
                        type="submit"
                        disabled={!amountValid || !dateValid || busy}
                        className="px-7 py-3.5 rounded-xl bg-primary hover:bg-gold-deep text-on-primary font-label-md text-label-md font-bold flex items-center gap-2 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span>{busy ? "Opening UPI..." : "Next: UPI & Screenshot Proof →"}</span>
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* SLIDE 3: Side-by-Side Aligned UPI QR & Screenshot Proof */}
              {step === 3 && payment && (
                <div className="flex flex-col gap-5 animate-fadeIn">
                  {/* Step Navigation Bar */}
                  <div className="flex items-center justify-between pb-3 border-b border-line/60">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="inline-flex items-center gap-1.5 text-primary hover:text-gold-deep font-label-md text-[13px] font-bold cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                      <span>Back to Amount</span>
                    </button>

                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full bg-gold-soft text-primary font-label-sm text-[11px] uppercase font-bold tracking-wider">
                        Slide 3 of 3 &bull; Pay &amp; Proof
                      </span>
                      <button
                        type="button"
                        onClick={cancelPayment}
                        className="text-error hover:underline font-label-sm text-[11px] font-semibold ml-2 cursor-pointer"
                      >
                        Cancel Draft
                      </button>
                    </div>
                  </div>

                  {/* Summary Banner */}
                  <div className="p-3 px-4 rounded-xl bg-gold-soft/60 border border-gold-soft-deep/40 flex items-center justify-between text-body-sm text-on-surface">
                    <div className="flex items-center gap-2">
                      <span className="font-code-md font-bold text-primary">Unit {payment.wing}-{payment.flat}</span>
                      <span>&bull;</span>
                      <span className="font-body-sm text-ink-soft">{payment.ownerName || "Resident"}</span>
                    </div>
                    <div className="font-headline-sm text-title-lg font-bold text-primary tabular-nums">
                      {inr(payment.amount)}
                    </div>
                  </div>

                  {/* 2-Column Aligned Layout (Side by Side) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-stretch">
                    
                    {/* Left Column: QR Code & UPI Apps */}
                    <div className="p-5 rounded-2xl bg-surface-container-low border border-line/70 flex flex-col justify-between gap-4">
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <span className="font-label-sm text-label-sm uppercase tracking-wider text-primary font-bold flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[18px]">qr_code_scanner</span>
                            1. Scan Dynamic QR
                          </span>
                          <span className="font-code-md text-title-md font-bold text-primary">
                            {inr(payment.amount)}
                          </span>
                        </div>

                        {/* Scannable Dynamic QR */}
                        <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-surface border border-line/60 shadow-sm">
                          <div className="p-2 bg-surface rounded-lg shadow-inner">
                            <UpiQr uri={uri} size={168} />
                          </div>
                          <span className="font-code-md text-[11px] text-ink-soft mt-2 text-center">
                            Scan with GPay, PhonePe, Paytm or BHIM
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2.5">
                        {/* VPA Copy Row */}
                        <div className="flex items-center justify-between p-2.5 rounded-xl bg-gold-soft/70 border border-gold-soft-deep/60">
                          <code className="font-code-md text-[12px] text-on-surface font-semibold truncate max-w-[190px]">
                            {settings.upiId}
                          </code>
                          <button
                            type="button"
                            onClick={handleCopyUpiId}
                            className="px-2.5 py-1 rounded-lg bg-surface hover:bg-gold-soft text-primary font-label-md text-[11px] font-semibold border border-gold-soft-deep/60 shadow-sm transition-all cursor-pointer whitespace-nowrap"
                          >
                            Copy VPA
                          </button>
                        </div>

                        {/* Direct App Launchers */}
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={handleOpenGpay}
                            className="py-2 px-2 rounded-xl bg-surface hover:bg-gold-soft text-on-surface font-label-md text-[12px] flex items-center justify-center gap-1 transition-colors border border-line cursor-pointer shadow-sm"
                          >
                            <span className="material-symbols-outlined text-[16px] text-primary">phone_iphone</span>
                            <span>GPay</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleOpenPhonePe}
                            className="py-2 px-2 rounded-xl bg-surface hover:bg-gold-soft text-on-surface font-label-md text-[12px] flex items-center justify-center gap-1 transition-colors border border-line cursor-pointer shadow-sm"
                          >
                            <span className="material-symbols-outlined text-[16px] text-primary">bolt</span>
                            <span>PhonePe</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleOpenAnyUpi}
                            className="py-2 px-2 rounded-xl bg-surface hover:bg-gold-soft text-on-surface font-label-md text-[12px] flex items-center justify-center gap-1 transition-colors border border-line cursor-pointer shadow-sm"
                          >
                            <span className="material-symbols-outlined text-[16px] text-primary">account_balance_wallet</span>
                            <span>Any UPI</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Screenshot Proof & 12-Digit UTR */}
                    <div className="p-5 rounded-2xl bg-surface-container-low border border-line/70 flex flex-col justify-between gap-4">
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <span className="font-label-sm text-label-sm uppercase tracking-wider text-primary font-bold flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[18px]">photo_camera</span>
                            2. Attach Screenshot Proof
                          </span>
                          <span className="font-code-md text-[10px] text-ink-soft bg-surface px-2 py-0.5 rounded border border-line">
                            Instant OCR
                          </span>
                        </div>

                        {/* Upload Dropzone */}
                        {!shotUrl && !ocrBusy && (
                          <button
                            type="button"
                            onClick={() => document.getElementById("shot-deck-input")?.click()}
                            className="w-full py-4 px-3 rounded-xl bg-surface hover:bg-gold-soft/50 text-on-surface border-2 border-dashed border-primary/40 transition-all flex flex-col items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                          >
                            <span className="material-symbols-outlined text-[28px] text-primary">cloud_upload</span>
                            <span className="font-title-md text-[13px] font-semibold text-primary">Upload Payment Screenshot</span>
                            <span className="font-body-sm text-[11px] text-ink-soft">JPG, PNG or UPI payment screenshot</span>
                          </button>
                        )}

                        <input
                          id="shot-deck-input"
                          type="file"
                          accept="image/*"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            handleShot(f);
                          }}
                        />

                        {/* OCR Progress */}
                        {ocrBusy && (
                          <div className="p-4 rounded-xl bg-surface border border-line flex flex-col gap-2">
                            <div className="w-full bg-surface-container-high h-2.5 rounded-full overflow-hidden">
                              <div
                                className="bg-primary h-full rounded-full transition-all duration-300"
                                style={{ width: `${Math.max(12, ocrPct)}%` }}
                              />
                            </div>
                            <span className="font-code-md text-[11px] text-ink-soft text-center">
                              Scanning screenshot via Tesseract OCR&hellip; {ocrPct > 0 ? `${ocrPct}%` : "reading"}
                            </span>
                          </div>
                        )}

                        {/* Screenshot Thumbnail */}
                        {shotUrl && !ocrBusy && (
                          <div className="flex items-center gap-3 p-3 rounded-xl bg-surface border border-line shadow-sm">
                            <img
                              src={shotUrl}
                              alt="Payment screenshot"
                              className="w-14 h-14 object-cover rounded-lg border border-line shrink-0"
                            />
                            <div className="flex-1 flex flex-col overflow-hidden">
                              {shotMeta?.verdict === "matched" && (
                                <span className="font-label-sm text-success font-semibold flex items-center gap-1">
                                  <span className="material-symbols-outlined text-[15px]">check_circle</span>
                                  Verified: UTR {shotMeta.ocrUtr}
                                </span>
                              )}
                              {shotMeta?.verdict === "partial" && (
                                <span className="font-label-sm text-warning font-semibold flex items-center gap-1">
                                  <span className="material-symbols-outlined text-[15px]">info</span>
                                  Partial read &bull; verify UTR
                                </span>
                              )}
                              {shotMeta?.verdict === "unreadable" && (
                                <span className="font-label-sm text-ink-soft font-semibold flex items-center gap-1">
                                  <span className="material-symbols-outlined text-[15px]">image</span>
                                  Screenshot attached
                                </span>
                              )}
                              <div className="flex items-center gap-2 mt-1">
                                <button
                                  type="button"
                                  onClick={() => document.getElementById("shot-deck-input")?.click()}
                                  className="text-[11px] text-primary hover:underline font-semibold cursor-pointer"
                                >
                                  Replace
                                </button>
                                <span className="text-[11px] text-muted">&bull;</span>
                                <button
                                  type="button"
                                  onClick={removeShot}
                                  className="text-[11px] text-error hover:underline font-semibold cursor-pointer"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {ocrHint && <p className="text-body-sm text-warning text-[11px]">{ocrHint}</p>}

                        {/* 12-Digit UTR Input */}
                        <div className="flex flex-col gap-1 mt-1">
                          <div className="flex items-center justify-between">
                            <label className="font-label-sm text-[11px] text-ink-soft uppercase tracking-wider font-semibold">
                              12-Digit UPI Reference (UTR)
                            </label>
                            {utr.length === 12 && (
                              <span className="font-code-md text-[10px] text-success font-bold flex items-center gap-1">
                                <span className="material-symbols-outlined text-[12px]">check</span> Valid 12 digits
                              </span>
                            )}
                          </div>
                          <input
                            type="text"
                            maxLength={12}
                            inputMode="numeric"
                            value={utr}
                            onChange={(e) => {
                              setUtr(e.target.value.replace(/\D/g, "").slice(0, 12));
                              setUtrError("");
                            }}
                            placeholder="e.g. 431289004218"
                            className="w-full px-3.5 py-2.5 rounded-xl bg-surface font-code-md text-title-md text-on-surface outline-none border border-line focus:ring-2 focus:ring-primary shadow-sm tracking-widest"
                          />
                          {utrError && <p className="text-body-sm text-warning text-[11px]">{utrError}</p>}
                        </div>

                        {/* Treasurer Note */}
                        <div className="flex flex-col gap-1">
                          <label className="font-label-sm text-[11px] text-ink-soft uppercase tracking-wider font-semibold">
                            Treasurer Note (Optional)
                          </label>
                          <input
                            type="text"
                            value={payNote}
                            onChange={(e) => setPayNote(e.target.value)}
                            placeholder="e.g. Paid from family GPay"
                            className="w-full px-3 py-2 rounded-xl bg-surface font-body-sm text-[12px] text-on-surface outline-none border border-line shadow-sm"
                          />
                        </div>
                      </div>

                      {/* Confirm Button */}
                      <button
                        type="button"
                        onClick={submitUtr}
                        disabled={busy || utr.length !== 12}
                        className="w-full py-3.5 rounded-xl bg-primary hover:bg-gold-deep text-on-primary font-label-md text-label-md font-bold shadow-md hover:shadow-lg transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                      >
                        {busy ? "Submitting Reference&hellip;" : "I've Paid — Confirm & Submit Reference"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* SLIDE 4: Payment Confirmation */}
              {step === 4 && payment && (
                <div className="flex flex-col items-center text-center gap-4 py-6 animate-popIn">
                  <div className="w-18 h-18 rounded-full bg-gold-soft text-primary flex items-center justify-center shadow-lg relative my-1">
                    <div className="absolute inset-0 rounded-full border-2 border-primary animate-ping opacity-30" />
                    <span className="material-symbols-outlined text-[38px]">verified</span>
                  </div>

                  <h2 className="font-headline-md text-headline-md text-on-surface font-bold">
                    Payment Recorded!
                  </h2>
                  <p className="font-body-md text-ink-soft max-w-md">
                    Your maintenance payment of <strong className="text-on-surface">{inr(payment.amount)}</strong> for Flat{" "}
                    <strong>{payment.wing}-{payment.flat}</strong> has been logged under reference <strong>{payment.id}</strong>.
                  </p>

                  {/* Summary Voucher */}
                  <div className="w-full max-w-md p-4 rounded-xl bg-surface-container-low font-code-md text-[13px] text-left text-on-surface space-y-2 border border-line my-1">
                    <div className="flex justify-between">
                      <span className="text-ink-soft">Target Unit:</span>
                      <strong>{payment.wing}-{payment.flat}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-soft">Settled Amount:</span>
                      <strong className="text-primary">{inr(payment.amount)}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-soft">Payment Date:</span>
                      <strong>{paymentDate}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink-soft">Bank UTR Ref:</span>
                      <strong>{payment.utr || "Verified locally"}</strong>
                    </div>
                    <div className="flex justify-between text-success">
                      <span>Ledger Status:</span>
                      <strong>Awaiting Committee Confirmation</strong>
                    </div>
                  </div>

                  <div className="w-full max-w-md mt-2">
                    <button
                      type="button"
                      onClick={resetToStep1}
                      className="w-full py-3.5 px-4 rounded-xl bg-primary hover:bg-gold-deep text-on-primary font-label-md text-label-md font-bold shadow-md transition-all text-center cursor-pointer"
                    >
                      Pay for Another Flat
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* Persistent Right Rail: 4 Columns */}
          <aside className="lg:col-span-4 flex flex-col gap-space-md lg:sticky lg:top-24">
            {/* Society Treasury Progress */}
            <div className="p-5 rounded-2xl bg-surface shadow-sm border border-line flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-label-sm text-label-sm uppercase tracking-widest text-primary font-semibold">
                  Society Treasury
                </span>
                <span className="px-2 py-0.5 rounded-full bg-success/10 text-success font-code-md text-[11px] font-bold">
                  {collectionPct}% Cleared
                </span>
              </div>
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="font-headline-md text-headline-md font-bold text-on-surface tabular-nums">
                    {clearedCount} / {totalCount}
                  </span>
                  <span className="font-code-md text-body-sm text-ink-soft">
                    {members.filter((m) => m.dueBalance > 0).length} Pending
                  </span>
                </div>
                {/* Gold Gradient Progress Bar */}
                <div className="w-full h-3 rounded-full bg-surface-container-high overflow-hidden mt-2 relative">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-gold-light transition-all duration-700"
                    style={{ width: `${collectionPct}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between text-ink-soft font-body-sm text-[12px] pt-1">
                <span>Total Units: {totalCount}</span>
                <span className="text-primary font-medium">Zero Gateway Fees</span>
              </div>
            </div>

            {/* Executive Notices Preview */}
            <div className="p-5 rounded-2xl bg-surface shadow-sm border border-line flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-title-md text-title-md text-on-surface font-semibold">
                  Executive Notices
                </span>
                <Link
                  to="/notices"
                  className="px-2 py-0.5 rounded bg-gold-soft text-primary font-code-md text-[11px] hover:bg-gold-soft-deep/60 transition-colors"
                >
                  Notice Board &rarr;
                </Link>
              </div>

              <div className="flex flex-col gap-2.5">
                {(notices ?? []).slice(0, 3).map((n) => (
                  <div
                    key={n.id}
                    className="p-3 rounded-xl bg-surface-soft hover:bg-gold-soft/30 transition-all flex flex-col gap-1 border border-line/50"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`px-2 py-0.5 rounded font-label-sm text-[10px] uppercase font-semibold ${
                          n.tone === "warn"
                            ? "bg-warning/10 text-warning"
                            : n.tone === "event"
                            ? "bg-primary/10 text-primary"
                            : "bg-surface text-ink-soft"
                        }`}
                      >
                        {n.tone?.toUpperCase() || "NOTICE"}
                      </span>
                      <span className="font-code-md text-[11px] text-ink-soft">
                        {new Date(n.createdAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    </div>
                    <h3 className="font-title-md text-[14px] font-semibold text-on-surface line-clamp-1">
                      {n.title}
                    </h3>
                    <p className="font-body-sm text-[12px] text-ink-soft line-clamp-2">{n.body}</p>
                  </div>
                ))}
                {(!notices || notices.length === 0) && (
                  <p className="font-body-sm text-muted py-2">No notices posted on the board yet.</p>
                )}
              </div>
            </div>

            {/* Managing Committee Quick Contacts */}
            <div className="p-5 rounded-2xl bg-surface shadow-sm border border-line flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-title-md text-title-md text-on-surface font-semibold">
                  Managing Committee
                </span>
                <Link
                  to="/directory"
                  className="font-label-md text-primary hover:text-gold-deep text-[12px] font-medium transition-colors"
                >
                  Full Directory &rarr;
                </Link>
              </div>

              <div className="flex flex-col gap-2.5">
                {(contacts ?? [])
                  .filter((c) => c.category === "committee")
                  .slice(0, 3)
                  .map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-surface-container-low border border-line/60"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-gold-soft text-primary font-bold text-[12px] flex items-center justify-center">
                          {c.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <span className="font-title-md text-[13px] font-semibold text-on-surface block leading-tight">
                            {c.name}
                          </span>
                          <span className="font-label-sm text-[10px] text-primary uppercase">
                            {c.role}
                          </span>
                        </div>
                      </div>
                      <a
                        href={`tel:${c.phone}`}
                        className="w-8 h-8 rounded-full bg-surface text-ink-soft hover:text-primary hover:bg-gold-soft flex items-center justify-center transition-colors shadow-sm"
                        title={`Call ${c.phone}`}
                      >
                        <span className="material-symbols-outlined text-[16px]">call</span>
                      </a>
                    </div>
                  ))}
              </div>
            </div>

            {/* Emergency Protocols Rail */}
            <div className="p-4 rounded-2xl bg-error-container/40 border border-error-container flex flex-col gap-2">
              <span className="font-label-sm text-label-sm text-error uppercase font-bold tracking-wider flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">support</span>
                Emergency Estate Desks
              </span>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <a
                  href="tel:9820044556"
                  className="p-2.5 rounded-xl bg-surface flex flex-col hover:bg-surface-soft transition-colors shadow-sm"
                >
                  <span className="font-label-sm text-[10px] text-ink-soft uppercase font-semibold">
                    Security Gate 1
                  </span>
                  <span className="font-code-md text-[13px] font-bold text-on-surface">Ext. 101</span>
                </a>
                <a
                  href="tel:1800425001"
                  className="p-2.5 rounded-xl bg-surface flex flex-col hover:bg-surface-soft transition-colors shadow-sm"
                >
                  <span className="font-label-sm text-[10px] text-ink-soft uppercase font-semibold">
                    Lift Trap SOS
                  </span>
                  <span className="font-code-md text-[13px] font-bold text-error">1800-425-001</span>
                </a>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
