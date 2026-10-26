"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Car, Navigation, Trash2 } from "lucide-react";
import type { PlanOption } from "@/lib/commute-types";
import { useActiveTrip } from "@/lib/commute-store";
import { clock } from "../format";
import { usePlan, type PlanInput } from "../hooks";
import type { AppModel } from "../model";
import { IconButton, Notice, PrimaryButton, SecondaryButton, Skeleton, StateMessage } from "../ui";
import { costText, LegTimeline, listRow, ModeStrip, optionLabel } from "./common";

/** Where to start the walk back: the class building entrance, or a location the person just shared. */
function returnOrigin(app: AppModel, useMe: boolean) {
  if (useMe && app.userLocation) return { lon: app.userLocation[0], lat: app.userLocation[1], label: "Current location" };
  const b = app.destBuilding;
  if (!b) return app.origin;
  const e = b.entrances[0];
  return e ? { lon: e.lon, lat: e.lat, label: b.name } : { lon: b.center[0], lat: b.center[1], label: b.name };
}

/** The last transit departure today that still reaches the car (park-and-ride and similar). */
function useLastService(app: AppModel) {
  const car = app.parked;
  const from = returnOrigin(app, false);
  const input: PlanInput = useMemo(() => {
    if (!car || !from) return null;
    const k = Math.cos((car.lat * Math.PI) / 180);
    const far = Math.hypot((car.lon - from.lon) * k, car.lat - from.lat) * 111_195 > 1500;
    if (!far) return null;
    return {
      campus: car.campus,
      origin: from,
      buildingId: "",
      toPoint: { lon: car.lon, lat: car.lat, label: car.label },
      deadline: null,
      departNow: false,
      lastService: true,
      parkUntil: null,
      vehicle: { permits: [], registered: null, hasCar: false, mpg: null },
      fuelPrice: null,
      walkSpeedMps: app.prefs.walkSpeedMps,
      modes: ["transit"],
    };
  }, [car, from, app.prefs.walkSpeedMps]);
  return usePlan(input, app.now);
}

/** Nothing saved yet: say how a car gets saved, and where to find parking. */
function NoCar({ app }: { app: AppModel }) {
  return (
    <div className="space-y-3 pt-2">
      <StateMessage icon={<Car className="h-5 w-5" />} title="No car saved" action={app.campus ? <SecondaryButton onClick={() => app.go({ kind: "parking" }, "half")}>Find campus parking</SecondaryButton> : undefined}>
        When a trip ends at a campus parking place, tap Save car here and CrossMetric will show how long you can stay and the way back.
      </StateMessage>
    </div>
  );
}

export function ParkedPanel({ app }: { app: AppModel }) {
  const car = app.parked;
  const last = useLastService(app);
  if (!car) return <NoCar app={app} />;
  const until = car.until;
  const soon = until !== null && until - app.now < 30 * 60_000;
  const lastLeave = last.plan?.recommended?.leaveBy ?? null;
  const buffer = app.prefs.returnBufferMin * 60_000;
  return (
    <div className="space-y-4 pt-1">
      <div className="flex items-start gap-3">
        <Car className="mt-1 h-6 w-6 shrink-0" aria-hidden />
        <div className="min-w-0">
          <h2 className="t-section [overflow-wrap:anywhere]">{car.label}</h2>
          <p className="text-small text-app-muted">Saved {clock(car.savedAt)}</p>
        </div>
      </div>
      {until ? (
        soon ? (
          <Notice tone={until < app.now ? "red" : "amber"}>{until < app.now ? `Parking eligibility ended ${clock(until)}` : `Parking eligibility ends ${clock(until)} · move by then`}</Notice>
        ) : (
          <p className="t-num border-t border-app-line pt-3 text-body">
            Parking OK until <span className="font-semibold">{clock(until)}</span>
          </p>
        )
      ) : (
        <p className="border-t border-app-line pt-3 text-body text-app-muted">Parking end time not set.</p>
      )}
      {last.plan ? (
        lastLeave ? (
          lastLeave - buffer < app.now ? (
            <Notice tone="red">Last bus to your car leaves {clock(lastLeave)}</Notice>
          ) : (
            <p className="t-num border-t border-app-line pt-3 text-body">
              Last bus to your car: leave by <span className="font-semibold">{clock(lastLeave)}</span>
            </p>
          )
        ) : (
          <Notice tone="red">No bus back to your car later today. Plan another way back.</Notice>
        )
      ) : null}
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <PrimaryButton onClick={() => app.go({ kind: "return" }, "half")} icon={<Navigation className="h-5 w-5" aria-hidden />}>
          Back to car
        </PrimaryButton>
        <SecondaryButton onClick={() => app.setParked(null)} icon={<Trash2 className="h-4 w-4" aria-hidden />} aria-label="Forget saved car">
          Clear
        </SecondaryButton>
      </div>
    </div>
  );
}

export function ReturnPanel({ app }: { app: AppModel }) {
  const car = app.parked;
  const [useMe, setUseMe] = useState(false);
  const [, setTrip] = useActiveTrip();
  const [picked, setPicked] = useState<string | null>(null);
  const from = returnOrigin(app, useMe);
  const input: PlanInput = useMemo(() => {
    if (!car || !from) return null;
    return {
      campus: car.campus,
      origin: from,
      buildingId: "",
      toPoint: { lon: car.lon, lat: car.lat, label: car.label },
      deadline: null,
      departNow: true,
      parkUntil: null,
      vehicle: { permits: [], registered: null, hasCar: false, mpg: null },
      fuelPrice: null,
      walkSpeedMps: app.prefs.walkSpeedMps,
      modes: ["walk", "transit"],
    };
  }, [car, from, app.prefs.walkSpeedMps]);
  const plan = usePlan(input, app.now);
  const options = plan.plan ? [plan.plan.recommended, ...plan.plan.alternatives].filter((o): o is PlanOption => !!o) : [];
  const sel = options.find((o) => o.id === picked) ?? options[0] ?? null;
  if (!car) return <NoCar app={app} />;
  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-start gap-1">
        <IconButton label="Back" onClick={() => window.history.back()} className="-ml-2">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h2 className="t-section [overflow-wrap:anywhere]">Back to {car.label}</h2>
          <p className="flex flex-wrap items-center gap-x-2 text-small text-app-muted">
            From {from?.label ?? "—"}
            {!useMe ? (
              <button
                type="button"
                className="min-h-[36px] font-medium text-app-route"
                onClick={async () => {
                  if (await app.locate()) setUseMe(true);
                }}
              >
                Use my location
              </button>
            ) : null}
          </p>
          {app.locError ? <p className="text-small text-app-amber">{app.locError}</p> : null}
        </div>
      </div>
      {plan.loading && !plan.plan ? <Skeleton className="h-20 w-full" /> : null}
      {plan.error && !plan.plan ? <Notice tone="gray">{plan.error.error}</Notice> : null}
      <ul>
        {options.map((o) => {
          const on = sel?.id === o.id;
          return (
            <li key={o.id} className={listRow(on)}>
              <button type="button" aria-pressed={on} onClick={() => setPicked(o.id)} className="cm-press flex w-full items-center gap-3 py-3 text-left">
                <span className="min-w-0 flex-1">
                  <ModeStrip option={o} />
                  <span className="mt-1.5 block text-small text-app-muted">
                    {optionLabel(o)} · arrive {clock(o.arriveAt)} · {costText(o)}
                  </span>
                </span>
                <span className="t-num shrink-0 text-component font-semibold">{o.minutes} min</span>
              </button>
            </li>
          );
        })}
      </ul>
      {sel ? (
        <PrimaryButton
          icon={<Navigation className="h-5 w-5" aria-hidden />}
          onClick={() => {
            setTrip({ campus: car.campus, option: sel, buildingId: "", leg: 0, startedAt: Date.now(), occurrenceKey: null });
            app.go({ kind: "trip" });
          }}
        >
          Start
        </PrimaryButton>
      ) : null}
      {sel && app.snap !== "rest" ? <LegTimeline option={sel} /> : null}
    </div>
  );
}
