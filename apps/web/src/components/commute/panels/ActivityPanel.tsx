"use client";

import { Car, CheckCircle2, ChevronRight, CircleSlash, Clock3, GraduationCap, Navigation, RotateCcw, Trash2 } from "lucide-react";
import type { JourneyMode } from "@crossmetric/engine/commute";
import { Glyph, type GlyphName } from "@/components/brand/Glyph";
import { useActiveTrip, useRecentSearches, useTripHistory, type PastTrip } from "@/lib/commute-store";
import { clock, dayLabel, duration, when } from "../format";
import type { AppModel } from "../model";
import { SectionLabel, StateMessage } from "../ui";

const GLYPH: Record<JourneyMode, GlyphName> = { walk: "walk", bike: "bike", transit: "transit", drive: "drive", park_ride: "park_ride" };

/** Four street-grid routes; a trip picks one from its id, so each row keeps the same picture. Decorative. */
const THUMB_ROUTES = ["M10 66 L10 44 L34 44 L34 20 L66 20", "M10 66 L44 66 L44 38 L66 38 L66 12", "M10 40 L30 40 L30 66 L56 66 L56 14 L66 14", "M10 20 L34 20 L34 48 L66 48 L66 66"];

function pick(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % THUMB_ROUTES.length;
}

/** The small dark route picture at the start of a trip row (Uber shows a map snapshot here; CrossMetric keeps no route). */
function TripThumb({ id, kind }: { id: string; kind: string }) {
  const d = THUMB_ROUTES[pick(id)]!;
  const glyph = kind in GLYPH ? GLYPH[kind as JourneyMode] : null;
  return (
    <span className="relative block h-[76px] w-[76px] shrink-0 overflow-hidden rounded-ctl bg-[#07111F]" aria-hidden>
      <svg viewBox="0 0 76 76" className="absolute inset-0 h-full w-full">
        <g stroke="#23272b" strokeWidth="5" strokeLinecap="round" fill="none">
          {[10, 34, 44, 56].map((x) => (
            <line key={`v${x}`} x1={x} y1="-4" x2={x} y2="80" />
          ))}
          {[14, 20, 38, 44, 66].map((y) => (
            <line key={`h${y}`} x1="-4" y1={y} x2="80" y2={y} />
          ))}
        </g>
        <path d={d} stroke="#91F24D" strokeOpacity="0.35" strokeWidth="9" strokeLinejoin="round" strokeLinecap="round" fill="none" />
        <path d={d} stroke="#91F24D" strokeWidth="3.4" strokeLinejoin="round" strokeLinecap="round" fill="none" />
      </svg>
      {glyph ? (
        <span className="absolute bottom-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-full bg-uber text-on-uber" style={{ ["--glyph-cut" as string]: "var(--color-uber)" }}>
          <Glyph name={glyph} className="h-[18px] w-[18px]" />
        </span>
      ) : null}
    </span>
  );
}

/**
 * Activity, like the Uber app's: what is happening or coming up (a trip in
 * progress, a parked car, the next class), then past trips and searches.
 * Everything here lives in this browser only; past trips keep labels and
 * times, never coordinates or the route drawn.
 */
export function ActivityPanel({ app }: { app: AppModel }) {
  const [trip] = useActiveTrip();
  const [history, setHistory] = useTripHistory();
  const [searches, setSearches] = useRecentSearches();
  const next = app.nextClass;
  const nextBuilding = next?.buildingId ? app.buildings.get(next.buildingId) : null;
  const upcoming = !!trip || !!app.parked || !!(next && nextBuilding);
  const past = app.prefs.keepHistory ? history : [];
  const recent = app.prefs.keepHistory ? searches.slice(0, 5) : [];

  return (
    <div className="space-y-7">
      <section className="space-y-3" aria-label="Upcoming">
        <SectionLabel>Upcoming</SectionLabel>
        {upcoming ? (
          <ul className="space-y-2.5">
            {trip ? (
              <li>
                <ActivityCard
                  tone="strong"
                  icon={<Navigation className="h-5 w-5" aria-hidden />}
                  title={`Trip to ${trip.destLabel ?? "your destination"}`}
                  sub={`In progress · step ${Math.min(trip.leg + 1, trip.option.legs.length)} of ${trip.option.legs.length} · started ${clock(trip.startedAt)}`}
                  action="Resume"
                  onClick={() => app.go({ kind: "trip" })}
                />
              </li>
            ) : null}
            {app.parked ? (
              <li>
                <ActivityCard icon={<Car className="h-5 w-5" aria-hidden />} title={`Car at ${app.parked.label}`} sub={`Saved ${when(app.parked.savedAt, app.now)}${app.parked.until ? ` · eligible until ${clock(app.parked.until)}` : ""}`} action="Way back" onClick={() => app.go({ kind: "parked" }, "half")} />
              </li>
            ) : null}
            {next && nextBuilding ? (
              <li>
                <ActivityCard
                  icon={<GraduationCap className="h-5 w-5" aria-hidden />}
                  title={next.title ?? nextBuilding.name}
                  sub={`${nextBuilding.name} · ${when(next.start, app.now)}`}
                  action="Plan"
                  onClick={() => {
                    const e = nextBuilding.entrances[0];
                    app.journey.startSearch(
                      { label: nextBuilding.name, lon: e?.lon ?? nextBuilding.center[0], lat: e?.lat ?? nextBuilding.center[1], source: "building", campus: app.campus, buildingId: nextBuilding.id },
                      { timing: { mode: "arrive", by: next.start - app.prefs.entryBufferMin * 60_000 } },
                    );
                    app.go({ kind: "plan" }, "half");
                  }}
                />
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="text-small text-app-muted">Nothing coming up. Trips you start, a parked car and your next class show here.</p>
        )}
      </section>

      <section className="space-y-2" aria-label="Past trips">
        <SectionLabel
          action={
            past.length ? (
              <button type="button" onClick={() => window.confirm("Remove past trips from this browser?") && setHistory([])} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-chip px-2 text-small font-medium text-app-muted hover:text-app-ink">
                <Trash2 className="h-4 w-4" aria-hidden /> Clear
              </button>
            ) : undefined
          }
        >
          Past
        </SectionLabel>
        {past.length ? (
          <ul className="divide-y divide-app-line">
            {past.map((t) => (
              <li key={t.id}>
                <PastRow t={t} now={app.now} onOpen={() => app.go({ kind: "receipt", id: t.id }, "full")} />
              </li>
            ))}
          </ul>
        ) : !app.prefs.keepHistory ? (
          <StateMessage icon={<Clock3 className="h-5 w-5" />} title="History is off">
            Turn on &ldquo;Keep recent searches and trips&rdquo; in Account to see past trips here.
          </StateMessage>
        ) : (
          <p className="text-small text-app-muted">No trips yet. Choose a route and tap Start trip; finished trips are listed here.</p>
        )}
      </section>

      {recent.length ? (
        <section className="space-y-1" aria-label="Recent searches">
          <SectionLabel
            action={
              <button type="button" onClick={() => setSearches([])} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-chip px-2 text-small font-medium text-app-muted hover:text-app-ink">
                <Trash2 className="h-4 w-4" aria-hidden /> Clear
              </button>
            }
          >
            Searches
          </SectionLabel>
          <ul className="divide-y divide-app-line">
            {recent.map((r) => (
              <li key={r.id + r.at}>
                <button
                  type="button"
                  onClick={() => {
                    const x = app.journey.restore(r, app.now);
                    if (x.needsLocation) void app.currentPlace().then((p) => p && app.journey.setOrigin(p));
                    app.go({ kind: "plan" }, "half");
                  }}
                  className="cm-press flex min-h-[64px] w-full items-center gap-3.5 text-left"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center text-app-muted" aria-hidden>
                    <Clock3 className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium">{r.to.label}</span>
                    <span className="block truncate text-small text-app-muted">
                      {"current" in r.from ? "From your location" : `From ${r.from.label}`} · {dayLabel(r.at, app.now)}
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-chip bg-app-chip px-3 py-2 text-small font-medium">
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Again
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ActivityCard({ icon, title, sub, action, onClick, tone }: { icon: React.ReactNode; title: string; sub: string; action: string; onClick: () => void; tone?: "strong" }) {
  const strong = tone === "strong";
  return (
    <button type="button" onClick={onClick} className={`cm-press flex w-full items-center gap-3 rounded-surface p-4 text-left ${strong ? "bg-[#07111F] text-[#F5F8FC]" : "bg-app-chip hover:bg-app-chip-hover"}`}>
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${strong ? "bg-uber text-on-uber" : "bg-app-surface"}`} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-semibold">{title}</span>
        <span className={`block truncate text-small ${strong ? "text-[#9BAABD]" : "text-app-muted"}`}>{sub}</span>
      </span>
      <span className={`inline-flex shrink-0 items-center gap-0.5 text-small font-semibold ${strong ? "text-uber" : ""}`}>
        {action}
        <ChevronRight className="h-4 w-4" aria-hidden />
      </span>
    </button>
  );
}

function PastRow({ t, now, onOpen }: { t: PastTrip; now: number; onOpen: () => void }) {
  const took = Math.max(1, Math.round((t.endedAt - t.startedAt) / 60_000));
  return (
    <button type="button" onClick={onOpen} aria-label={`${t.to}, ${dayLabel(t.startedAt, now)}. Open trip`} className="cm-press flex min-h-[96px] w-full items-center gap-3.5 py-2.5 text-left">
      <TripThumb id={t.id} kind={t.kind} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium">{t.to}</span>
        <span className="block truncate text-small text-app-muted">
          {dayLabel(t.startedAt, now)} · {clock(t.startedAt)} · {t.title}
        </span>
        <span className="tnum mt-1 flex items-center gap-1 text-small text-app-muted">
          {t.completed ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-app-teal" aria-hidden /> : <CircleSlash className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span className="truncate">
            {t.completed ? "Arrived" : `Ended early · ${t.stepsDone} of ${t.steps} steps done`} · planned {duration(t.plannedMin)}, took {duration(took)}
          </span>
        </span>
      </span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-app-muted" aria-hidden />
    </button>
  );
}
