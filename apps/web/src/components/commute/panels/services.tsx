"use client";

import Link from "next/link";
import { BarChart3, Bike, Car, CarTaxiFront, ChevronRight, CircleParking, Clock3, Footprints, GraduationCap, MapPinned, MapPinPlus, Moon, Route, School, ShieldCheck, SquareParking, TrainFront, UsersRound, type LucideIcon } from "lucide-react";
import { Glyph, type GlyphName } from "@/components/brand/Glyph";
import type { AppModel } from "../model";

/**
 * Services: every way CrossMetric can help, in one grid (the Uber app's Services
 * tab). Each tile opens a real tool; nothing here is a placeholder.
 */
export interface Service {
  id: string;
  label: string;
  detail: string;
  Icon: LucideIcon;
  /** A custom pictogram for the main ways of travelling; the other services use their icon. */
  glyph?: GlyphName;
  run?: (app: AppModel) => void;
  href?: string;
  /** Shown only when this is true for the person (a parked car, a campus). */
  when?: (app: AppModel) => boolean;
  /** Why the tile is unavailable, if it is. */
  blocked?: (app: AppModel) => string | null;
}

const noCar = (app: AppModel) => (app.prefs.hasCar ? null : "You said you don't have a car (Account)");

export const SERVICES: Record<string, Service> = {
  arrive: { id: "arrive", label: "Arrive by", detail: "When to leave, where to park, and a backup", Icon: Clock3, run: (app) => app.openArrive() },
  compare: { id: "compare", label: "Compare", detail: "Every way to get there, side by side", Icon: Route, glyph: "compare", run: (app) => app.searchFor(null) },
  transit: { id: "transit", label: "Transit", detail: "Trains and buses, with the walk to the stop", Icon: TrainFront, glyph: "transit", run: (app) => app.searchFor("transit") },
  walk: { id: "walk", label: "Walk", detail: "Walking routes, sidewalks preferred", Icon: Footprints, glyph: "walk", run: (app) => app.searchFor("walk") },
  bike: { id: "bike", label: "Bike", detail: "Bike routes, quieter streets option", Icon: Bike, glyph: "bike", run: (app) => app.searchFor("bike") },
  drive: { id: "drive", label: "Drive", detail: "Driving with a planning buffer", Icon: Car, glyph: "drive", run: (app) => app.searchFor("drive"), blocked: noCar },
  park_ride: { id: "park_ride", label: "Park & ride", detail: "Drive to MARTA, park, ride", Icon: SquareParking, glyph: "park_ride", run: (app) => app.searchFor("park_ride"), blocked: noCar },
  rideshare: { id: "rideshare", label: "Rideshare", detail: "Hand off to Uber or Lyft", Icon: CarTaxiFront, glyph: "rideshare", run: (app) => app.searchFor("rideshare") },
  nearby: { id: "nearby", label: "Nearby", detail: "MARTA and Athens stops by walking time", Icon: MapPinned, run: (app) => app.go({ kind: "nearby" }, "half") },
  parking: { id: "parking", label: "Parking", detail: "Campus places you may use, by the rules", Icon: CircleParking, run: (app) => app.go({ kind: "parking" }, "half") },
  night: { id: "night", label: "Night", detail: "Official escorts and safe rides", Icon: Moon, glyph: "night", run: (app) => app.go({ kind: "night" }, "half") },
  classes: { id: "classes", label: "Classes", detail: "Leave-by times for your classes", Icon: GraduationCap, run: (app) => app.go({ kind: "schedule" }, "full") },
  car: { id: "car", label: "Your car", detail: "Where you parked, and the way back", Icon: Car, glyph: "car", run: (app) => app.go({ kind: "parked" }, "half"), when: (app) => !!app.parked },
  safety: { id: "safety", label: "Safety", detail: "Toolkit: share, call for help, CrossScore", Icon: ShieldCheck, run: (app) => app.go({ kind: "safety" }, "full") },
  report: { id: "report", label: "Report a barrier", detail: "Blocked sidewalks, curb ramps, crossings", Icon: MapPinPlus, run: (app) => app.openReport() },
  community: { id: "community", label: "Community reports", detail: "Barriers others reported, and how they are confirmed", Icon: UsersRound, run: (app) => app.go({ kind: "community" }, "half") },
  routes: { id: "routes", label: "CrossScore", detail: "Street conditions on your route", Icon: Route, href: "/routes" },
  analysis: { id: "analysis", label: "Priority for Review", detail: "Road safety near Georgia schools, from crash records", Icon: BarChart3, href: "/analyze" },
  schools: { id: "schools", label: "Schools", detail: "Schools and colleges in Georgia", Icon: School, href: "/schools" },
};

const GROUPS: { title: string; ids: string[] }[] = [
  { title: "Go anywhere in Georgia", ids: ["transit", "walk", "bike", "drive", "park_ride", "rideshare", "nearby"] },
  { title: "Campus", ids: ["arrive", "parking", "night", "classes", "car"] },
  { title: "Community & safety", ids: ["report", "community", "safety", "routes", "analysis", "schools"] },
];

/** The picture for a service: its pictogram when it has one, else its icon. */
function ServiceArt({ s, size }: { s: Service; size: number }) {
  return s.glyph ? <Glyph name={s.glyph} style={{ width: size, height: size }} /> : <s.Icon style={{ width: size * 0.85, height: size * 0.85 }} strokeWidth={2} aria-hidden />;
}

/**
 * Mode tile (Home): a flat gray tile with the way of travelling drawn in ink at the top and its name
 * underneath, and an optional tag ("Free"). Tags state facts, never offers.
 */
export function SuggestionTile({ s, app, tag, label }: { s: Service; app: AppModel; tag?: string; /** A shorter name when the tile is narrow ("Ride" for Rideshare). */ label?: string }) {
  const blocked = s.blocked?.(app) ?? null;
  const inner = (
    <>
      {tag ? <span className="absolute right-2 top-2 rounded-tag bg-app-strong px-1.5 py-[3px] text-meta font-semibold leading-none text-app-on-strong">{tag}</span> : null}
      <span className="text-app-ink transition-transform duration-200 group-active:scale-90" style={{ ["--glyph-cut" as string]: "var(--app-chip)" }} aria-hidden>
        <ServiceArt s={s} size={34} />
      </span>
      <span className="max-w-full truncate text-small font-medium leading-tight">{label ?? s.label}</span>
    </>
  );
  const cls = "group cm-press relative flex h-[100px] min-w-0 flex-col items-start justify-between rounded-surface bg-app-chip p-3 text-left";
  return s.href ? (
    <Link href={s.href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" className={cls} onClick={() => s.run?.(app)} disabled={!!blocked} aria-label={blocked ? `${s.label}: ${blocked}` : s.label}>
      {inner}
    </button>
  );
}

/** A Services row: the picture, the name and what it does, with a chevron. Flat, divided by hairlines. */
function ServiceRow({ s, app }: { s: Service; app: AppModel }) {
  const blocked = s.blocked?.(app) ?? null;
  const inner = (
    <>
      <span className={`grid h-10 w-10 shrink-0 place-items-center ${blocked ? "text-app-muted" : "text-app-ink"}`} style={{ ["--glyph-cut" as string]: "var(--app-bg)" }} aria-hidden>
        <ServiceArt s={s} size={30} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium">{s.label}</span>
        <span className="block text-small text-app-muted">{blocked ?? s.detail}</span>
      </span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-app-muted" aria-hidden />
    </>
  );
  const cls = "cm-press flex min-h-[64px] w-full items-center gap-3 py-2 text-left";
  if (s.href)
    return (
      <Link href={s.href} className={cls}>
        {inner}
      </Link>
    );
  return (
    <button type="button" className={cls} onClick={() => s.run?.(app)} disabled={!!blocked} aria-label={blocked ? `${s.label}: ${blocked}` : undefined}>
      {inner}
    </button>
  );
}

export function ServicesPanel({ app }: { app: AppModel }) {
  return (
    <div className="space-y-8">
      {GROUPS.map((g) => {
        const items = g.ids.map((id) => SERVICES[id]!).filter((s) => !s.when || s.when(app));
        return (
          <section key={g.title} className="space-y-1" aria-label={g.title}>
            <h3 className="t-section">{g.title}</h3>
            <ul className="divide-y divide-app-line">
              {items.map((s) => (
                <li key={s.id}>
                  <ServiceRow s={s} app={app} />
                </li>
              ))}
            </ul>
            {g.title === "Campus" && !app.campus ? <p className="text-small text-app-muted">Campus tools ask you to choose Georgia Tech or UGA first.</p> : null}
          </section>
        );
      })}
    </div>
  );
}
