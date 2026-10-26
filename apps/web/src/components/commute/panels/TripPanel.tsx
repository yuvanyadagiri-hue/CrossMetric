"use client";

import { Car, Clock3, ExternalLink, ShieldCheck, TrainFront, X } from "lucide-react";
import type { ActiveTrip } from "@/lib/commute-store";
import { clock, metersLabel, minutes } from "../format";
import type { AppModel } from "../model";
import { IconButton, LinkButton, PrimaryButton, SecondaryButton } from "../ui";
import { LegIcon, LegTimeline, RouteBadge } from "./common";

/**
 * Step-by-step guidance. Legs advance only when the person confirms them:
 * CrossMetric does not track location in the background and never assumes
 * someone boarded, parked or arrived.
 */
export function TripPanel({ app, trip, setTrip }: { app: AppModel; trip: ActiveTrip; setTrip: (t: ActiveTrip | null) => void }) {
  const legs = trip.option.legs;
  const i = Math.min(trip.leg, legs.length - 1);
  const leg = legs[i]!;
  const last = i === legs.length - 1;
  const end = (completed = false) => {
    app.endTrip(completed);
    if (completed) app.go({ kind: "arrived" }, "full", true);
    else app.go(app.parked ? { kind: "parked" } : { kind: "home" }, "half", true);
  };
  const next = () => {
    if (!last) return setTrip({ ...trip, leg: i + 1 });
    // Arriving on a trip back to the car means the car is no longer parked.
    if (!trip.buildingId && app.parked) {
      app.setParked(null);
      app.endTrip(true);
      return app.go({ kind: "arrived" }, "full", true);
    }
    end(true);
  };
  const arriveAt = legs[legs.length - 1]?.arrive ?? null;
  const saveCar = () => {
    const placeId = leg.parkingPlaceId ?? null;
    const place = placeId ? app.bundle?.parking.find((p) => p.id === placeId) : null;
    if (!place) return;
    const campus = trip.campus ?? app.campus;
    if (!campus) return;
    app.setParked({ campus, placeId, label: place.name, lon: place.center[0], lat: place.center[1], savedAt: Date.now(), until: trip.option.parking?.usableUntil ?? app.parkUntil });
  };
  const target = leg.geometry[leg.geometry.length - 1];

  let title: React.ReactNode;
  let sub: React.ReactNode = null;
  let action: React.ReactNode = <PrimaryButton onClick={next}>{last ? "I've arrived" : "Next step"}</PrimaryButton>;
  switch (leg.kind) {
    case "walk": {
      const step = leg.steps?.[0];
      title = `Walk to ${leg.to}`;
      sub = (
        <>
          {step ? (
            <span className="block text-body text-app-ink">
              {step.instruction}
              {step.meters > 20 ? <span className="whitespace-nowrap text-app-muted"> · {metersLabel(step.meters)}</span> : null}
            </span>
          ) : null}
          <span className="t-num">
            {minutes(leg.minutes)}
            {leg.arrive ? ` · arrive ${clock(leg.arrive)}` : ""}
          </span>
        </>
      );
      break;
    }
    case "drive":
      title = `Drive to ${leg.to}`;
      sub = (
        <>
          <span className="block text-body text-app-ink">Use your maps app for turn-by-turn driving.</span>
          <span className="t-num">
            {minutes(leg.minutes)} without traffic{leg.arrive ? ` · park by ${clock(leg.arrive)}` : ""}
          </span>
        </>
      );
      action = (
        <div className="space-y-2">
          {target ? (
            <div className="grid grid-cols-2 gap-2">
              <LinkButton href={`https://www.google.com/maps/dir/?api=1&destination=${target[1]},${target[0]}&travelmode=driving`} icon={<ExternalLink className="h-4 w-4" aria-hidden />}>
                Google Maps
              </LinkButton>
              <LinkButton href={`https://maps.apple.com/?daddr=${target[1]},${target[0]}&dirflg=d`} icon={<ExternalLink className="h-4 w-4" aria-hidden />}>
                Apple Maps
              </LinkButton>
            </div>
          ) : null}
          <PrimaryButton onClick={next}>I&rsquo;m here</PrimaryButton>
        </div>
      );
      break;
    case "park": {
      const place = app.bundle?.parking.find((p) => p.id === leg.parkingPlaceId);
      title = `Park at ${leg.to}`;
      const until = trip.option.parking?.usableUntil;
      sub = (
        <>
          {place?.payment ? <span className="block text-body text-app-ink">{place.payment}</span> : null}
          {until ? <span className="t-num">Eligible until {clock(until)}</span> : <span>Check signs at the entrance</span>}
        </>
      );
      const saved = app.parked && app.parked.placeId === leg.parkingPlaceId;
      action = (
        <div className="space-y-2">
          <PrimaryButton
            icon={<Car className="h-5 w-5" aria-hidden />}
            onClick={() => {
              if (!saved) saveCar();
              next();
            }}
          >
            {saved ? "Next step" : "Save car here"}
          </PrimaryButton>
          {!saved ? (
            <SecondaryButton className="w-full" onClick={next}>
              Skip
            </SecondaryButton>
          ) : null}
        </div>
      );
      break;
    }
    case "wait":
      title = `Wait at ${leg.from}`;
      sub = <span className="t-num">Until {clock(leg.arrive)}</span>;
      break;
    case "ride":
      title = (
        <span className="inline-flex flex-wrap items-center gap-2">
          {leg.route ? <RouteBadge route={leg.route} /> : null}
          <span>to {leg.to}</span>
        </span>
      );
      sub = (
        <>
          <span className="block text-body text-app-ink">
            Board at {leg.from}
            {leg.headsign ? ` toward ${leg.headsign}` : ""}
          </span>
          <span className="t-num">
            {leg.headway ? `About every ${Math.round(leg.headway / 60)} min · ` : `Scheduled ${clock(leg.depart)} · `}
            {leg.stops ? `${leg.stops} stops · ` : ""}get off about {clock(leg.arrive)}
          </span>
        </>
      );
      action = <PrimaryButton onClick={next}>{last ? "I've arrived" : "I got off"}</PrimaryButton>;
      break;
  }

  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-small font-medium text-app-muted">{trip.destLabel ? `To ${trip.destLabel}` : "Your trip"}</p>
          <p className="t-section t-num">
            {arriveAt ? `Arrive about ${clock(arriveAt)}` : `Step ${i + 1} of ${legs.length}`}
          </p>
          <p className="text-small text-app-muted">Step {i + 1} of {legs.length}</p>
        </div>
        <IconButton label="End trip" onClick={() => end(false)}>
          <X className="h-5 w-5" aria-hidden />
        </IconButton>
      </div>
      <ol className="flex items-center gap-1" aria-label={`Step ${i + 1} of ${legs.length}`}>
        {legs.map((l, k) => (
          <li key={k} className={`h-2 flex-1 rounded-full ${k < i ? "bg-app-ink" : k === i ? "bg-app-accent shadow-[inset_0_0_0_1.5px_var(--app-select)]" : "bg-app-line-strong"}`} aria-hidden />
        ))}
      </ol>
      <div className="cm-on-dark flex items-start gap-3 rounded-sheet bg-[#07111F] p-4" aria-live="polite">
        <span className="mt-1 shrink-0 text-uber">
          <LegIcon leg={leg} className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <p className="t-section [overflow-wrap:anywhere]">{title}</p>
          <p className="mt-1.5 space-y-1 text-small text-app-muted">{sub}</p>
        </div>
      </div>
      {action}
      <div className="grid grid-cols-2 divide-x divide-app-line border-y border-app-line" role="group" aria-label="Trip tools">
        <TripTool icon={<ShieldCheck className="h-5 w-5" aria-hidden />} label="Safety" onClick={() => app.go({ kind: "safety" }, "full")} />
        {leg.kind === "ride" && leg.fromStop ? (
          <TripTool icon={<TrainFront className="h-5 w-5" aria-hidden />} label="Stop times" onClick={() => app.go({ kind: "stop", stop: leg.fromStop! })} />
        ) : (
          <TripTool icon={<Clock3 className="h-5 w-5" aria-hidden />} label="All steps" onClick={() => app.setSnap("full")} />
        )}
      </div>
      {app.snap !== "rest" ? (
        <div className="border-t border-app-line pt-2">
          <LegTimeline option={trip.option} activeLeg={i} />
          {leg.kind === "walk" && leg.steps?.length ? (
            <details className="mt-2 border-t border-app-line text-small">
              <summary className="flex min-h-[48px] cursor-pointer items-center text-body font-medium">All walking directions</summary>
              <ol className="list-decimal space-y-1.5 pb-2 pl-5 text-app-muted">
                {leg.steps.map((s, k) => (
                  <li key={k}>
                    {s.instruction}
                    {s.meters > 20 ? ` · ${metersLabel(s.meters)}` : ""}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
          <button type="button" onClick={() => end(false)} className="mt-2 inline-flex min-h-[44px] items-center gap-2 text-body font-medium text-app-red">
            <X className="h-4 w-4" aria-hidden />
            End trip early
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** In-trip tool: a bare icon and its name, side by side in a divided row (like the row under the driver card in Uber). */
function TripTool({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="cm-press flex min-h-[56px] items-center justify-center gap-2 text-body font-medium">
      {icon}
      {label}
    </button>
  );
}
