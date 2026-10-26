"use client";

import { useState } from "react";
import Link from "next/link";
import { BarChart3, Bookmark, BookOpen, ChevronRight, CircleHelp, Download, GraduationCap, Home, LocateFixed, MonitorSmartphone, ReceiptText, Route, School, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { JOURNEY_MODES, type JourneyMode, type Priority } from "@crossmetric/engine/commute";
import { clearAllLocalData, useFeedbackCodes, useRecentSearches, useSavedPlaces, useTripHistory, type CommutePrefs } from "@/lib/commute-store";
import { promptInstall, useInstall } from "@/lib/pwa";
import { normalizeTravel, PRIORITY_LABEL } from "@/lib/journey-client";
import { MODE_LABEL } from "@/lib/journey-types";
import { MODE_ICON } from "../journey-ui";
import type { AppModel } from "../model";
import { Chip, Notice, PanelHeader, SectionLabel, Segmented, Toggle } from "../ui";
import { Disclosure, SourceLinks } from "./common";

function NumberField({ id, label, value, onChange, step = 1, min, max, suffix }: { id: string; label: string; value: number | null; onChange: (v: number | null) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  return (
    <label htmlFor={id} className="flex min-h-[48px] items-center justify-between gap-3 text-body">
      <span>{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          max={max}
          value={value ?? ""}
          placeholder="—"
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className="h-11 w-24 rounded-chip border border-app-line-strong bg-app-surface px-2 text-right text-body"
        />
        {suffix ? <span className="w-12 text-small text-app-muted">{suffix}</span> : null}
      </span>
    </label>
  );
}

function NavRow({ icon, title, sub, onClick, href }: { icon: React.ReactNode; title: string; sub?: string; onClick?: () => void; href?: string }) {
  const inner = (
    <>
      <span className="grid h-10 w-10 shrink-0 place-items-center text-app-ink" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium">{title}</span>
        {sub ? <span className="block truncate text-small text-app-muted">{sub}</span> : null}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-app-muted" aria-hidden />
    </>
  );
  const cls = "cm-press flex min-h-[60px] w-full items-center gap-3 text-left hover:bg-app-chip";
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

/**
 * Install as an app: the browser's own prompt where there is one (Chrome, Edge, Android),
 * instructions on iPhone and iPad, nothing once installed.
 */
function InstallSection({ app }: { app: AppModel }) {
  const install = useInstall();
  const [busy, setBusy] = useState(false);
  if (install.installed) {
    return (
      <section className="space-y-1" aria-label="App">
        <SectionLabel>App</SectionLabel>
        <p className="flex items-center gap-2 text-small text-app-muted">
          <MonitorSmartphone className="h-4 w-4 shrink-0" aria-hidden /> Installed. Saved places, settings and your last result open without a connection.
        </p>
      </section>
    );
  }
  if (!install.canPrompt && !install.ios) return null;
  return (
    <section className="space-y-2" aria-label="App">
      <SectionLabel>App</SectionLabel>
      <div className="flex items-start gap-3 rounded-surface border border-app-line p-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ctl bg-app-strong text-app-on-strong" aria-hidden>
          <MonitorSmartphone className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-body font-semibold">Install CrossMetric</p>
            <p className="text-small text-app-muted">{install.ios ? "In Safari, tap Share, then Add to Home Screen." : "Opens like an app from your home screen or dock. Saved places and settings work offline."}</p>
          </div>
          {install.canPrompt ? (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await promptInstall();
                setBusy(false);
                if (r === "accepted") app.toast("CrossMetric is installed.");
              }}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-ctl bg-app-primary px-4 text-small font-semibold text-app-on-primary hover:bg-app-primary-hover"
            >
              <Download className="h-4 w-4" aria-hidden /> Install
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** Profile: travel preferences, car and parking, campus and classes, reminders, privacy, and the analysis tools. */
export function ProfilePanel({ app }: { app: AppModel }) {
  const { prefs, setPrefs } = app;
  const set = <K extends keyof CommutePrefs>(k: K, v: CommutePrefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));
  const [permitText, setPermitText] = useState(prefs.permits.join(", "));
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null);
  const [, setRecents] = useRecentSearches();
  const [, setHistory] = useTripHistory();
  const [places] = useSavedPlaces();
  const travel = normalizeTravel(prefs.travel);
  const classes = app.campus ? app.schedule.manual.filter((c) => c.campus === app.campus).length + (app.schedule.imported?.campus === app.campus ? app.schedule.imported.series.length : 0) : 0;

  const toggleReminders = async (on: boolean) => {
    set("reminders", on);
    setNotifyMsg(null);
    if (!on) return;
    if (!("Notification" in window)) {
      setNotifyMsg("This browser can't show notifications. Reminders appear in CrossMetric while it's open.");
      return;
    }
    if (Notification.permission === "default") await Notification.requestPermission().catch(() => undefined);
    setNotifyMsg(Notification.permission === "granted" ? "Reminders show while CrossMetric is open in a tab. They are not guaranteed if the tab is closed." : "Notifications are blocked. Reminders appear in CrossMetric while it's open.");
  };

  const modesOn = JOURNEY_MODES.filter((m) => travel.modes[m]).map((m) => MODE_LABEL[m]);
  const location =
    app.locationPermission === "granted" ? "Allowed for this site. Used only when you tap a location button." : app.locationPermission === "denied" ? "Blocked for this site. You can change it in your browser's site settings, or enter addresses instead." : "Not shared. CrossMetric asks only when you tap a location button.";

  return (
    <div className="space-y-6">
      <section className="divide-y divide-app-line" aria-label="Shortcuts">
        <NavRow icon={<Bookmark className="h-5 w-5" />} title="Saved" sub={places.length ? `${places.length} ${places.length === 1 ? "place" : "places"}` : "Add home, work and other places"} onClick={() => app.go({ kind: "saved" }, "full")} />
        <NavRow icon={<ReceiptText className="h-5 w-5" />} title="Your trips" sub="Trips you took, kept on this device" onClick={() => app.go({ kind: "activity" }, "full")} />
        <NavRow icon={<CircleHelp className="h-5 w-5" />} title="Help" sub="How CrossMetric works" onClick={() => app.go({ kind: "help" }, "full")} />
        <NavRow icon={<ShieldCheck className="h-5 w-5" />} title="Safety toolkit" sub="Emergency numbers, share a trip, CrossScore" onClick={() => app.go({ kind: "safety" }, "full")} />
      </section>

      <section className="space-y-1 border-t border-app-line pt-6" aria-label="Travel">
        <SectionLabel>Travel</SectionLabel>
        <NavRow icon={<SlidersHorizontal className="h-4 w-4" />} title="Travel preferences" sub={`${PRIORITY_LABEL[travel.priority]} · ${modesOn.join(", ")}${travel.accessible ? " · step-free" : ""}`} onClick={() => app.go({ kind: "prefs" }, "full")} />
        <Segmented label="Walking pace" value={prefs.walkSpeedMps} options={[[1.0, "Relaxed"], [1.25, "Average"], [1.5, "Brisk"]]} onChange={(v) => set("walkSpeedMps", v)} />
      </section>

      <section className="space-y-2 border-t border-app-line pt-6" aria-label="Car and parking">
        <SectionLabel>Car &amp; parking</SectionLabel>
        <Toggle label="I have a car to drive" detail="Off: no driving or park & ride options (ride-hail is still shown)" checked={prefs.hasCar} onChange={(v) => set("hasCar", v)} />
        <NumberField id="mpg" label="Car mpg" value={prefs.mpg} onChange={(v) => set("mpg", v !== null && v > 0 ? v : null)} min={5} max={150} suffix="mpg" />
        <NumberField id="fuel" label="Gas price you pay" value={prefs.fuelPrice} onChange={(v) => set("fuelPrice", v !== null && v > 0 ? v : null)} step={0.01} min={0.5} max={15} suffix="$/gal" />
        <p className="text-small text-app-muted">With mpg and a gas price, driving costs include gas. Without them, gas is left out and said so.</p>
      </section>

      <section className="space-y-2 border-t border-app-line pt-6" aria-label="Campus">
        <SectionLabel>Campus</SectionLabel>
        <Segmented
          label="Campus context (buildings, campus parking, night services)"
          value={app.campus}
          options={[
            [null, "None"],
            ["gt", "Georgia Tech"],
            ["uga", "UGA"],
          ]}
          onChange={(v) => app.setCampus(v)}
        />
        {app.campus ? (
          <>
            <NavRow icon={<GraduationCap className="h-4 w-4" />} title="Classes" sub={classes ? `${classes} on ${app.campus === "gt" ? "Georgia Tech" : "UGA"}` : "Add classes or import a calendar"} onClick={() => app.go({ kind: "schedule" }, "full")} />
            <NumberField id="entry-buffer" label="Time to get to your seat" value={prefs.entryBufferMin} onChange={(v) => set("entryBufferMin", Math.max(0, Math.min(30, v ?? 5)))} min={0} max={30} suffix="min" />
            <div>
              <label htmlFor="permits" className="mb-1 block text-small font-medium">
                Parking permit areas
              </label>
              <input
                id="permits"
                value={permitText}
                onChange={(e) => setPermitText(e.target.value)}
                onBlur={() =>
                  set(
                    "permits",
                    permitText
                      .split(/[,\s]+/)
                      .map((p) => p.trim().toUpperCase())
                      .filter((p) => /^[A-Z0-9-]{2,12}$/.test(p))
                      .slice(0, 6),
                  )
                }
                placeholder={app.campus === "gt" ? "e.g. W23" : "e.g. S09, E23"}
                className="h-12 w-full rounded-ctl border border-app-line-strong bg-app-surface px-3 text-body"
              />
              <p className="mt-1 text-small text-app-muted">Leave empty if you have no permit.</p>
            </div>
            {app.campus === "uga" ? <Segmented label="Vehicle registered with UGA Parking (free, not a permit)" value={prefs.registered} options={[[true, "Yes"], [false, "No"], [null, "Not sure"]]} onChange={(v) => set("registered", v)} /> : null}
          </>
        ) : (
          <p className="text-small text-app-muted">Optional. Routes work anywhere in Georgia without a campus.</p>
        )}
        <NavRow icon={<Home className="h-4 w-4" />} title="Usual start" sub={prefs.origin ? prefs.origin.label : "Not saved (used for class plans and reminders)"} onClick={() => app.openPicker("start")} />
      </section>

      {app.campus ? (
        <section className="space-y-2 border-t border-app-line pt-6" aria-label="Reminders">
          <SectionLabel>Reminders</SectionLabel>
          <Toggle label="Time-to-leave reminders for classes" checked={prefs.reminders} onChange={(v) => void toggleReminders(v)} />
          {notifyMsg ? <Notice tone="gray">{notifyMsg}</Notice> : <p className="text-small text-app-muted">Work while CrossMetric is open. Lock-screen text says only &ldquo;Time to leave&rdquo;.</p>}
          <NumberField id="prep" label="Heads-up before leaving" value={prefs.prepMin} onChange={(v) => set("prepMin", Math.max(0, Math.min(60, v ?? 10)))} suffix="min" />
        </section>
      ) : null}

      <section className="space-y-3 border-t border-app-line pt-6" aria-label="Appearance">
        <Segmented label="Appearance" value={prefs.appearance} options={[["system", "System"], ["light", "Light"], ["dark", "Dark"]]} onChange={(v) => set("appearance", v)} />
        <Segmented label="Map" value={prefs.mapStyle} options={[["dark", "Dark"], ["light", "Light"], ["auto", "Match appearance"]]} onChange={(v) => set("mapStyle", v)} />
      </section>

      <InstallSection app={app} />

      <section className="space-y-2 border-t border-app-line pt-6" aria-label="Privacy and location">
        <SectionLabel>Privacy &amp; location</SectionLabel>
        <p className="flex items-start gap-2 text-small text-app-muted">
          <LocateFixed className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <span className="font-medium text-app-ink">Location: </span>
            {location}
          </span>
        </p>
        <Toggle
          label="Keep recent searches and trips"
          detail="On this device only. Searches from your current location and finished trips are saved without coordinates"
          checked={prefs.keepHistory}
          onChange={(v) => {
            set("keepHistory", v);
            if (!v) {
              setRecents([]);
              setHistory([]);
            }
          }}
        />
        <Disclosure summary="What CrossMetric stores">
          <p>Your places, searches, past trips, classes, permits and parked car are stored only in this browser. Planning sends the start and destination to CrossMetric&rsquo;s server to compute routes; nothing is kept.</p>
          <button
            type="button"
            className="mt-2 min-h-[44px] font-medium text-app-red"
            onClick={() => {
              if (window.confirm("Remove your places, searches, classes, car and settings from this browser?")) {
                clearAllLocalData();
                window.location.reload();
              }
            }}
          >
            Clear my data
          </button>
        </Disclosure>
      </section>

      <section className="space-y-1 border-t border-app-line pt-6" aria-label="Safety and analysis">
        <SectionLabel>Safety &amp; analysis</SectionLabel>
        <NavRow icon={<Route className="h-4 w-4" />} title="Route safety (CrossScore)" sub="Compare safer, balanced and faster street routes" href="/routes" />
        <NavRow icon={<BarChart3 className="h-4 w-4" />} title="Road safety analysis" sub="Priority for Review around Georgia schools" href="/analyze" />
        <NavRow icon={<School className="h-4 w-4" />} title="Schools & colleges" href="/schools" />
        <NavRow icon={<BookOpen className="h-4 w-4" />} title="Methodology & data" href="/methodology" />
      </section>

      <Disclosure summary="Data & sources">
        <div className="space-y-3">
          <p>Routing: OpenStreetMap via Valhalla (no live traffic). Addresses: OpenStreetMap via Photon, limited to Georgia. Weather: National Weather Service.</p>
          <p>Transit timetables (scheduled, not live): MARTA; Athens-Clarke County Transit; UGA Campus Transit. Georgia Tech&rsquo;s Stinger has no public timetable feed. Other Georgia agencies are not included yet.</p>
          <p>
            MARTA station parking: from MARTA&rsquo;s parking page and its Aug 20, 2026 rate notice, checked Oct 13, 2026.{" "}
            <a className="underline" href="https://itsmarta.com/parking-availability.aspx" target="_blank" rel="noopener noreferrer">
              itsmarta.com
            </a>
          </p>
          {app.bundle ? <SourceLinks sources={app.bundle.sources} ids={Object.keys(app.bundle.sources)} /> : null}
        </div>
      </Disclosure>

      <FeedbackForm campus={app.campus ?? "none"} />
    </div>
  );
}

/** Travel preferences: hard constraints decide what is offered; the priority orders what is left. */
export function PrefsPanel({ app }: { app: AppModel }) {
  const travel = normalizeTravel(app.prefs.travel);
  const setTravel = (patch: Partial<typeof travel>) => app.setPrefs((p) => ({ ...p, travel: { ...normalizeTravel(p.travel), ...patch } }));
  const priorities: [Priority, string][] = [
    ["balanced", "Quickest overall; ties go to fewer transfers and less walking"],
    ["fastest", "Quickest door to door"],
    ["cheapest", "Lowest known cost"],
    ["least_walking", "Least walking"],
    ["fewest_transfers", "Fewest transfers"],
    ["safety", "Fewer crash risk indicators on the street part (same kind of trip only)"],
  ];
  const order: JourneyMode[] = ["walk", "transit", "drive", "park_ride", "bike"];
  return (
    <div className="space-y-6 pt-1">
      <PanelHeader title="Travel preferences" sub="Used for every new search. Change them any time." onBack={app.back} />
      <section className="space-y-1" aria-label="Ways to travel">
        <SectionLabel>Ways to travel</SectionLabel>
        <p className="text-small text-app-muted">Turned-off ways are never offered.</p>
        {order.map((m) => (
          <Toggle
            key={m}
            label={
              <span className="inline-flex items-center gap-2">
                {MODE_ICON[m]("h-4 w-4")}
                {MODE_LABEL[m]}
              </span>
            }
            detail={(m === "drive" || m === "park_ride") && !app.prefs.hasCar ? "You said you don't have a car" : m === "park_ride" ? "Drive to a MARTA station with parking, then ride" : undefined}
            checked={travel.modes[m]}
            onChange={(v) => setTravel({ modes: { ...travel.modes, [m]: v } })}
          />
        ))}
      </section>
      <section className="space-y-3" aria-label="Limits">
        <SectionLabel>Limits</SectionLabel>
        <p className="text-small text-app-muted">Options over a limit are left out, and the results say which and why.</p>
        <Segmented label="Most walking in one trip" value={travel.maxWalkMin} options={[[null, "No limit"], [10, "10 min"], [15, "15"], [20, "20"], [30, "30"]]} onChange={(v) => setTravel({ maxWalkMin: v })} />
        <Segmented label="Most transfers" value={travel.maxTransfers} options={[[null, "No limit"], [0, "None"], [1, "1"], [2, "2"]]} onChange={(v) => setTravel({ maxTransfers: v })} />
        <Toggle label="Require step-free access" detail="Walking avoids mapped steps. Transit counts only when every stop and trip used is published as accessible (MARTA publishes this; UGA and Athens-Clarke Transit do not)." checked={travel.accessible} onChange={(v) => setTravel({ accessible: v })} />
      </section>
      <section className="space-y-2" aria-label="Priority">
        <SectionLabel>Best match</SectionLabel>
        <p className="text-small text-app-muted">Chosen among options no more than about a quarter (at least 10 min) slower than the fastest. Other labels still show genuine alternatives.</p>
        <div role="radiogroup" aria-label="Best match priority" className="space-y-1">
          {priorities.map(([p, text]) => (
            <button key={p} type="button" role="radio" aria-checked={travel.priority === p} onClick={() => setTravel({ priority: p })} className={`flex min-h-[52px] w-full items-center gap-3 rounded-ctl border px-3 text-left ${travel.priority === p ? "border-app-primary bg-app-route-bg" : "border-app-line hover:bg-app-chip"}`}>
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${travel.priority === p ? "border-app-primary" : "border-app-line-strong"}`} aria-hidden>
                {travel.priority === p ? <span className="h-2.5 w-2.5 rounded-full bg-app-primary" /> : null}
              </span>
              <span>
                <span className="block text-body font-medium">{PRIORITY_LABEL[p]}</span>
                <span className="block text-small text-app-muted">{text}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="space-y-2" aria-label="Prefer">
        <SectionLabel>Prefer, when it is about as quick</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {(["walk", "transit", "bike", "drive"] as JourneyMode[]).map((m) => (
            <Chip key={m} active={travel.prefer.includes(m)} icon={MODE_ICON[m]("h-4 w-4")} onClick={() => setTravel({ prefer: travel.prefer.includes(m) ? travel.prefer.filter((x) => x !== m) : [...travel.prefer, m] })}>
              {MODE_LABEL[m]}
            </Chip>
          ))}
        </div>
      </section>
    </div>
  );
}

function FeedbackForm({ campus }: { campus: string }) {
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<{ tone: "gray" | "amber"; text: string } | null>(null);
  const [codes, setCodes] = useFeedbackCodes();
  const send = async () => {
    setState(null);
    const res = await fetch("/api/research/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campus, text, consent }) }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { deletionCode?: string; error?: string } | null;
    if (!res?.ok || !body?.deletionCode) return setState({ tone: "amber", text: body?.error ?? "Couldn't send feedback." });
    setCodes((c) => [...c, { code: body.deletionCode!, at: Date.now() }].slice(-10));
    setText("");
    setConsent(false);
    setState({ tone: "gray", text: "Thanks. Kept for 30 days without your name; you can delete it here." });
  };
  return (
    <section className="space-y-2" aria-label="Feedback">
      <SectionLabel>Tell us what went wrong</SectionLabel>
      <label htmlFor="feedback" className="sr-only">
        Feedback
      </label>
      <textarea id="feedback" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} placeholder="e.g. The deck was full at 9 and I was late" className="w-full rounded-ctl border border-app-line-strong bg-app-surface p-3 text-body" />
      <label className="flex min-h-[44px] items-start gap-2 text-small">
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--app-primary)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        CrossMetric may use this to improve the app. Don&rsquo;t include names or contact details.
      </label>
      <button type="button" onClick={send} disabled={!consent || text.trim().length < 5} className="min-h-[44px] rounded-ctl bg-app-chip px-4 text-body font-medium">
        Send feedback
      </button>
      {state ? <Notice tone={state.tone}>{state.text}</Notice> : null}
      {codes.length ? (
        <button
          type="button"
          className="block min-h-[44px] text-small font-medium text-app-red"
          onClick={async () => {
            for (const c of codes) await fetch("/api/research/feedback", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ deletionCode: c.code }) }).catch(() => null);
            setCodes([]);
            setState({ tone: "gray", text: "Your feedback was deleted." });
          }}
        >
          Delete feedback I sent ({codes.length})
        </button>
      ) : null}
    </section>
  );
}
