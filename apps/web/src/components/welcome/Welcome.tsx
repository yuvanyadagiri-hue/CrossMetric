"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Accessibility, ArrowRight, BadgeCheck, CircleDollarSign, MapPinPlus, ShieldCheck, Timer, TriangleAlert } from "lucide-react";
import { Glyph, type GlyphName } from "@/components/brand/Glyph";
import { BRAND, LogoLockup, MARK } from "@/components/brand/Logo";
import { markWelcomeSeen } from "@/components/commute/welcome-state";

/**
 * The first page of the app (after the launch screen): three swipeable slides answering the three
 * questions CrossMetric is for — how do I get there, which way fits me, and what is in the way — then
 * "Get started". No account, no sign-in, no questions. The pictures are labelled examples, never real
 * trips or reports.
 */

/** Slide 1: two paths cross at one point: the CrossMetric mark, with the ways to go around it. */
function MoveArt() {
  return (
    <svg viewBox="0 0 390 400" className="h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <g fill="none" strokeLinecap="round">
        <path d="M 40 370 L 350 40" stroke={BRAND.lime} strokeOpacity="0.14" strokeWidth="14" />
        <path d="M 40 40 L 350 370" stroke={BRAND.blue} strokeOpacity="0.14" strokeWidth="14" />
      </g>
      <g transform="translate(131 141) scale(2)" fill="none" strokeLinecap="round">
        <path d={MARK.fall} stroke={BRAND.blue} strokeWidth={MARK.stroke} />
        <path d={MARK.rise} stroke={BRAND.lime} strokeWidth={MARK.stroke} />
        <circle cx={MARK.node.cx} cy={MARK.node.cy} r={MARK.node.r} fill={BRAND.navy} stroke={BRAND.lime} strokeWidth={3} />
      </g>
      {[
        { x: 28, y: 52, label: "Walk" },
        { x: 252, y: 70, label: "Transit" },
        { x: 40, y: 318, label: "Drive" },
        { x: 262, y: 300, label: "Bike" },
      ].map((c) => (
        <g key={c.label} transform={`translate(${c.x} ${c.y})`}>
          <rect width="96" height="34" rx="10" fill="#0D1929" stroke="#1B2A3E" />
          <text x="48" y="22" textAnchor="middle" fontSize="14" fontWeight="600" fill="#F5F8FC" fontFamily="var(--font-inter)">
            {c.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Slide 2: one search, four ways to rank it. */
function CompareArt() {
  const prefs = [
    { Icon: Timer, label: "Fastest", on: true },
    { Icon: ShieldCheck, label: "Safest" },
    { Icon: Accessibility, label: "Most accessible" },
    { Icon: CircleDollarSign, label: "Lowest cost" },
  ];
  const rows: { glyph: GlyphName; title: string; time: string; cost: string; on?: boolean }[] = [
    { glyph: "transit", title: "MARTA Red Line", time: "18 min", cost: "$2.50", on: true },
    { glyph: "walk", title: "Walk", time: "34 min", cost: "Free" },
    { glyph: "drive", title: "Drive", time: "14 min", cost: "Parking unknown" },
  ];
  return (
    <div className="flex h-full flex-col justify-center gap-3 px-1">
      <div className="flex flex-wrap gap-1.5">
        {prefs.map(({ Icon, label, on }) => (
          <span key={label} className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-small font-medium ${on ? "bg-[#91F24D] text-[#07111F]" : "border border-[#1B2A3E] bg-[#0D1929] text-[#F5F8FC]"}`}>
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </span>
        ))}
      </div>
      <p className="px-1 pt-2 text-meta font-semibold text-[#9BAABD]">Example trip</p>
      {rows.map((r) => (
        <div key={r.title} className={`flex items-center gap-3 rounded-surface border p-3 ${r.on ? "border-[#91F24D] bg-[#11233A]" : "border-[#1B2A3E] bg-[#0D1929]"}`}>
          <span className="grid h-10 w-10 shrink-0 place-items-center text-[#F5F8FC]" style={{ ["--glyph-cut" as string]: r.on ? "#11233A" : "#0D1929" }}>
            <Glyph name={r.glyph} className="h-8 w-8" />
          </span>
          <span className="min-w-0 flex-1 truncate text-body font-semibold text-[#F5F8FC]">{r.title}</span>
          <span className="text-right">
            <span className="t-num block text-component font-semibold leading-none text-[#F5F8FC]">{r.time}</span>
            <span className="mt-1 block text-small text-[#9BAABD]">{r.cost}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Slide 3: a community report, confirmed by others. */
function ReportArt() {
  return (
    <div className="flex h-full flex-col justify-center gap-3 px-1">
      <p className="px-1 text-meta font-semibold text-[#9BAABD]">Example report</p>
      <div className="rounded-surface border border-[#1B2A3E] bg-[#0D1929] p-4 text-[#F5F8FC]">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#33240C] text-[#FFB547]">
            <TriangleAlert className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold">Missing curb ramp</p>
            <p className="text-small text-[#9BAABD]">Corner of a campus crosswalk</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-tag bg-[#33240C] px-2 py-0.5 text-meta font-semibold text-[#FFB547]">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
            Confirmed by 3
          </span>
        </div>
        <p className="mt-3 text-small text-[#9BAABD]">&ldquo;No ramp on the northeast corner; wheelchairs use the driveway.&rdquo;</p>
      </div>
      <div className="flex items-center gap-2 px-1 text-small text-[#9BAABD]">
        <MapPinPlus className="h-4 w-4 text-[#91F24D]" aria-hidden />
        Pin it, pick the barrier, send. Anonymous.
      </div>
    </div>
  );
}

const SLIDES: { id: string; title: string; body: string; art: React.ReactNode }[] = [
  { id: "move", title: "Map. Plan. Move.", body: "Walking, transit, biking, driving and rides around Georgia Tech, UGA and the rest of Georgia, on one map.", art: <MoveArt /> },
  { id: "compare", title: "The route that fits you.", body: "Compare real options by time, cost, crash-record safety and step-free access. Live data is labelled; estimates are too.", art: <CompareArt /> },
  { id: "report", title: "Flag what’s in the way.", body: "Report a blocked sidewalk, a missing curb ramp or a hard crossing. The community confirms it, so the barriers get seen.", art: <ReportArt /> },
];

export function Welcome() {
  const router = useRouter();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;

  const onScroll = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setIndex(Math.round(Math.min(SLIDES.length - 1, Math.max(0, el.scrollLeft / el.clientWidth))));
  }, []);
  const to = (i: number) => track.current?.scrollTo({ left: i * track.current.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  const skip = () => {
    markWelcomeSeen();
    router.replace("/");
  };

  return (
    <main id="main" className="cm-app absolute inset-0 flex flex-col bg-[#07111F] text-[#F5F8FC]" data-theme="dark">
      <div className="mx-auto flex h-full w-full max-w-[520px] flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between px-5" style={{ marginTop: "env(safe-area-inset-top)" }}>
          <LogoLockup size={32} />
          <button type="button" onClick={skip} className="cm-press min-h-[44px] rounded-full px-3 text-body font-semibold text-[#9BAABD] hover:text-[#F5F8FC]">
            Skip
          </button>
        </header>

        <h1 className="sr-only">Welcome to CrossMetric</h1>
        <div ref={track} onScroll={onScroll} className="cm-welcome-track min-h-0 flex-1" role="group" aria-roledescription="carousel" aria-label="What CrossMetric does">
          {SLIDES.map((s, i) => (
            <section key={s.id} className="cm-welcome-slide flex min-h-0 flex-col" aria-roledescription="slide" aria-label={`${i + 1} of ${SLIDES.length}`} aria-hidden={i !== index || undefined}>
              <div className="mx-5 mt-1 min-h-[200px] flex-1 overflow-hidden">{s.art}</div>
              <div className="px-5 pb-1 pt-5">
                <h2 className="t-page">{s.title}</h2>
                <p className="mt-3 max-w-[380px] text-body leading-relaxed text-[#9BAABD]">{s.body}</p>
              </div>
            </section>
          ))}
        </div>

        <footer className="shrink-0 px-5 pt-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}>
          <div className="mb-4 flex items-center gap-1.5" role="tablist" aria-label="Slides">
            {SLIDES.map((s, i) => (
              <button key={s.id} type="button" role="tab" aria-selected={i === index} aria-label={`Slide ${i + 1}`} onClick={() => to(i)} className="grid h-6 place-items-center px-0.5">
                <span className={`block h-[6px] rounded-full transition-all duration-300 ${i === index ? "w-7 bg-[#91F24D]" : "w-1.5 bg-[#2B3D55]"}`} />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => (last ? router.push("/welcome/location") : to(index + 1))}
            className="cm-press flex min-h-[56px] w-full items-center justify-center gap-2 rounded-ctl bg-[#91F24D] px-5 text-body font-semibold text-[#07111F] hover:bg-[#A6F56F]"
          >
            {last ? "Get started" : "Next"}
            <ArrowRight className="h-5 w-5" aria-hidden />
          </button>
          <p className="mt-3 text-small text-[#9BAABD]">No account. Your places stay on this device.</p>
        </footer>
      </div>
    </main>
  );
}
