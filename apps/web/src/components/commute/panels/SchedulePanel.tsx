"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Plus, Trash2, Upload } from "lucide-react";
import { addDays, localDate, type ManualClass, type Weekday } from "@crossmetric/engine/commute";
import type { ImportedSeries } from "@/lib/commute-store";
import { tz } from "../format";
import type { AppModel } from "../model";
import { searchBuildings } from "../search";
import { IconButton, Notice, PrimaryButton, SecondaryButton, SectionLabel } from "../ui";

const DAYS: [Weekday, string, string][] = [
  [1, "M", "Monday"],
  [2, "T", "Tuesday"],
  [3, "W", "Wednesday"],
  [4, "Th", "Thursday"],
  [5, "F", "Friday"],
  [6, "Sa", "Saturday"],
  [0, "Su", "Sunday"],
];

function BuildingPicker({ app, value, onChange, id }: { app: AppModel; value: string | null; onChange: (id: string) => void; id: string }) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => searchBuildings(q, app.bundle?.buildings ?? [], 5), [q, app.bundle]);
  const current = value ? app.buildings.get(value) : null;
  return (
    <div>
      {current ? <p className="mb-2 text-body font-medium [overflow-wrap:anywhere]">{current.name}</p> : null}
      <input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder={current ? "Change building" : "Search building"} className="h-12 w-full rounded-ctl border border-app-line-strong bg-app-surface px-3 text-body" autoComplete="off" />
      {hits.length ? (
        <ul className="mt-1 divide-y divide-app-line">
          {hits.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(b.id);
                  setQ("");
                }}
                className="cm-press flex min-h-[48px] w-full items-center px-1 text-left text-body [overflow-wrap:anywhere]"
              >
                {b.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AddClass({ app, onDone }: { app: AppModel; onDone: () => void }) {
  const today = localDate(app.now, tz);
  const [title, setTitle] = useState("");
  const [building, setBuilding] = useState<string | null>(app.destBuilding?.id ?? null);
  const [days, setDays] = useState<Weekday[]>([1, 3, 5]);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("09:50");
  const [until, setUntil] = useState(addDays(today, 70));
  const valid = building && days.length && start < end;
  return (
    <form
      className="space-y-4 border-t border-app-line pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        const c: ManualClass = { id: crypto.randomUUID(), title: title.trim().slice(0, 60) || undefined, campus: app.campus!, buildingId: building!, days, start, end, from: today, until };
        app.setSchedule((s) => ({ ...s, manual: [...s.manual, c] }));
        onDone();
      }}
    >
      <div>
        <label htmlFor="class-title" className="mb-1 block text-small font-medium">
          Name (optional)
        </label>
        <input id="class-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. CS 1332" className="h-12 w-full rounded-ctl border border-app-line-strong bg-app-surface px-3 text-body" />
      </div>
      <div>
        <label htmlFor="class-building" className="mb-1 block text-small font-medium">
          Building
        </label>
        <BuildingPicker app={app} value={building} onChange={setBuilding} id="class-building" />
      </div>
      <fieldset>
        <legend className="mb-1 text-small font-medium">Days</legend>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map(([d, l, full]) => (
            <button key={d} type="button" aria-label={full} aria-pressed={days.includes(d)} onClick={() => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]))} className={`cm-press h-11 min-w-11 rounded-ctl px-3 text-body font-medium ${days.includes(d) ? "bg-app-primary text-app-on-primary" : "bg-app-chip"}`}>
              {l}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-small font-medium">
          Starts
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 h-12 w-full rounded-ctl border border-app-line-strong bg-app-surface px-2 text-body" />
        </label>
        <label className="text-small font-medium">
          Ends
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 h-12 w-full rounded-ctl border border-app-line-strong bg-app-surface px-2 text-body" />
        </label>
        <label className="col-span-2 text-small font-medium">
          Repeats until
          <input type="date" value={until} min={today} onChange={(e) => setUntil(e.target.value)} className="mt-1 h-12 w-full rounded-ctl border border-app-line-strong bg-app-surface px-2 text-body" />
        </label>
      </div>
      <div className="flex gap-2">
        <PrimaryButton type="submit" disabled={!valid} className="!min-h-[48px] disabled:opacity-50">
          Add class
        </PrimaryButton>
        <SecondaryButton onClick={onDone}>Cancel</SecondaryButton>
      </div>
    </form>
  );
}

function SeriesRow({ app, s, onChange }: { app: AppModel; s: ImportedSeries; onChange: (s: ImportedSeries) => void }) {
  const b = s.buildingId ? app.buildings.get(s.buildingId) : null;
  const [pick, setPick] = useState(false);
  return (
    <li className="border-b border-app-line py-3 last:border-b-0">
      <p className="text-body font-medium [overflow-wrap:anywhere]">{s.title}</p>
      <p className="text-small text-app-muted [overflow-wrap:anywhere]">{s.location || "No location in the calendar"}</p>
      {s.match === "remote" ? (
        <label className="mt-1 inline-flex min-h-[44px] items-center gap-2 text-small">
          <input type="checkbox" className="h-5 w-5 accent-[var(--app-ink)]" checked={s.include === true} onChange={(e) => onChange({ ...s, include: e.target.checked ? true : null })} disabled={!s.buildingId} />
          Online · plan a commute anyway {s.buildingId ? "" : "(choose a building first)"}
        </label>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-2 text-small">
        {b ? <span className="font-medium">{b.name}</span> : <span className="font-medium text-app-amber">{s.candidates.length ? "Which building?" : "Building not found"}</span>}
        <button type="button" className="min-h-[36px] font-medium text-app-route" onClick={() => setPick((v) => !v)}>
          {b ? "Change" : "Choose"}
        </button>
      </div>
      {!b && s.candidates.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {s.candidates.map((id) => (
            <button key={id} type="button" onClick={() => onChange({ ...s, buildingId: id, match: "chosen", candidates: [] })} className="cm-press min-h-[44px] rounded-chip bg-app-chip px-3 text-small font-medium">
              {app.buildings.get(id)?.name ?? id}
            </button>
          ))}
        </div>
      ) : null}
      {pick ? (
        <div className="mt-2">
          <BuildingPicker
            app={app}
            id={`pick-${s.uid}`}
            value={s.buildingId}
            onChange={(id) => {
              onChange({ ...s, buildingId: id, match: "chosen", candidates: [] });
              setPick(false);
            }}
          />
        </div>
      ) : null}
    </li>
  );
}

export function SchedulePanel({ app }: { app: AppModel }) {
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ tone: "gray" | "amber"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const manual = app.schedule.manual.filter((c) => c.campus === app.campus);
  const imported = app.schedule.imported?.campus === app.campus ? app.schedule.imported : null;

  const onFile = async (file: File) => {
    setMsg(null);
    if (file.size > 2_000_000) return setMsg({ tone: "amber", text: "That file is too large for a class calendar." });
    try {
      const text = await file.text();
      const today = localDate(app.now, tz);
      // The calendar parser (ical.js) loads only when a file is imported.
      const { parseIcs } = await import("@/lib/ics");
      const res = parseIcs(text, app.bundle?.buildings ?? [], addDays(today, -1), addDays(today, 120));
      app.setSchedule((s) => ({ ...s, imported: { campus: app.campus!, fileName: file.name.slice(0, 80), importedAt: Date.now(), series: res.series, occurrences: res.occurrences } }));
      const unresolved = res.series.filter((x) => !x.buildingId && x.match !== "remote").length;
      setMsg({ tone: unresolved ? "amber" : "gray", text: `Imported ${res.series.length} ${res.series.length === 1 ? "class" : "classes"}${unresolved ? ` · ${unresolved} need a building` : ""}. This is a one-time copy, not a live sync.` });
    } catch {
      setMsg({ tone: "amber", text: "That file couldn't be read as a calendar (.ics)." });
    }
  };

  const updateSeries = (next: ImportedSeries) =>
    app.setSchedule((s) => (s.imported ? { ...s, imported: { ...s.imported, series: s.imported.series.map((x) => (x.uid === next.uid ? next : x)) } } : s));

  return (
    <div className="space-y-5 pt-1">
      <div className="flex items-center gap-1">
        <IconButton label="Back" onClick={() => window.history.back()} className="-ml-2">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </IconButton>
        <h2 className="t-section">Classes</h2>
      </div>

      <section className="space-y-2" aria-label="Your classes">
        {manual.length ? (
          <ul className="divide-y divide-app-line">
            {manual.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-3">
                <span className="min-w-0">
                  <span className="block text-body font-medium [overflow-wrap:anywhere]">{c.title ?? app.buildings.get(c.buildingId)?.name}</span>
                  <span className="t-num block text-small text-app-muted">
                    {c.title ? `${app.buildings.get(c.buildingId)?.name ?? "Unknown building"} · ` : ""}
                    {DAYS.filter(([d]) => c.days.includes(d))
                      .map(([, l]) => l)
                      .join(" ")}{" "}
                    {c.start}–{c.end}
                  </span>
                </span>
                <IconButton label={`Delete ${c.title ?? "class"}`} className="-mr-2" onClick={() => app.setSchedule((s) => ({ ...s, manual: s.manual.filter((x) => x.id !== c.id) }))}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : null}
        {adding ? (
          <AddClass app={app} onDone={() => setAdding(false)} />
        ) : (
          <SecondaryButton className="w-full" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setAdding(true)}>
            Add a class
          </SecondaryButton>
        )}
      </section>

      <section className="space-y-3 border-t border-app-line pt-5" aria-label="Import a calendar">
        <SectionLabel>Import a calendar file</SectionLabel>
        <p className="text-small text-app-muted">Export your class schedule as .ics (Outlook, Google Calendar, or Canvas). It is read on this device and never uploaded.</p>
        <input ref={fileRef} type="file" accept=".ics,text/calendar" className="sr-only" id="ics-file" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <SecondaryButton className="w-full" icon={<Upload className="h-4 w-4" aria-hidden />} onClick={() => fileRef.current?.click()}>
          Choose .ics file
        </SecondaryButton>
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
        {imported ? (
          <>
            <p className="text-small text-app-muted">
              From {imported.fileName}, imported {new Date(imported.importedAt).toLocaleDateString("en-US")}
            </p>
            <ul>
              {imported.series.map((s) => (
                <SeriesRow key={s.uid} app={app} s={s} onChange={updateSeries} />
              ))}
            </ul>
            <button type="button" onClick={() => app.setSchedule((s) => ({ ...s, imported: null }))} className="min-h-[44px] text-body font-medium text-app-red">
              Remove imported calendar
            </button>
          </>
        ) : null}
        <p className="text-small text-app-muted">Live Outlook and Google Calendar sync isn&rsquo;t connected yet.</p>
      </section>
    </div>
  );
}
