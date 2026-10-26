"use client";

import { useEffect, useId } from "react";
import { CameraOff, Check, CircleCheck, LocateFixed, MapPin, Pencil, Search, ShieldCheck } from "lucide-react";
import { categoryLabel, DESCRIPTION_MAX, REPORT_FLOW_CATEGORIES } from "@/lib/reports";
import type { AppModel } from "../model";
import type { ReportStep } from "../useCommunity";
import { PanelHeader, PrimaryButton, SecondaryButton, StateMessage } from "../ui";

const STEPS: ReportStep[] = ["location", "category", "details", "review"];
const TITLE: Record<ReportStep, string> = { location: "Where is the barrier?", category: "What's the barrier?", details: "Add a note", review: "Check and send", done: "Report sent" };

const coords = (lat: number, lon: number) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

/**
 * Report a barrier, one decision per step: the place (the pin over the map), the kind of barrier,
 * an optional note, then a review. "Report sent" appears only once the server has accepted and
 * saved the report; any refusal is shown with the server's reason and nothing is lost.
 */
export function ReportPanel({ app }: { app: AppModel }) {
  const f = app.report;
  const step = f.step;
  const index = STEPS.indexOf(step);

  // First time on the map for this report: centre on the person when their location is already known.
  useEffect(() => {
    if (f.isPlaced() || f.step !== "location" || f.location) return;
    if (app.userLocation) {
      f.markPlaced();
      app.flyTo(app.userLocation);
    }
    // Once per report, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const back = () => {
    f.setError(null);
    if (index > 0) f.setStep(STEPS[index - 1]!);
  };

  return (
    <div className="space-y-5 pb-2 pt-1">
      <PanelHeader
        title={TITLE[step]}
        sub={step === "done" ? undefined : `Report a barrier · step ${index + 1} of ${STEPS.length}`}
        onBack={index > 0 ? back : undefined}
        backLabel="Previous step"
      />
      {step !== "done" ? (
        <div className="flex gap-1" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s} className={`h-1 flex-1 rounded-full ${i <= index ? "bg-app-accent" : "bg-app-chip"}`} />
          ))}
        </div>
      ) : null}
      {step === "location" ? <LocationStep app={app} /> : step === "category" ? <CategoryStep app={app} /> : step === "details" ? <DetailsStep app={app} /> : step === "review" ? <ReviewStep app={app} /> : <DoneStep app={app} />}
    </div>
  );
}

function LocationStep({ app }: { app: AppModel }) {
  const pin = app.reportPin;
  return (
    <div className="space-y-4">
      <p className="text-body text-app-muted">{app.layout === "desktop" ? "Drag the map so the pin sits on the barrier." : "Move the map so the pin sits on the barrier."} Zoom in for a precise spot.</p>
      <div className="flex items-start gap-3 rounded-surface border border-app-line bg-app-surface p-3.5" aria-live="polite">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-app-route-bg text-app-route">
          <MapPin className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-medium [overflow-wrap:anywhere]">{pin ? (pin.label ?? (pin.resolving ? "Finding the nearest address…" : "A point on the map")) : "Waiting for the map…"}</span>
          {pin ? <span className="t-num block text-small text-app-muted">{coords(pin.lat, pin.lon)}</span> : null}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SecondaryButton
          icon={<LocateFixed className="h-4 w-4" aria-hidden />}
          onClick={async () => {
            const ll = await app.locate();
            if (ll) {
              app.report.markPlaced();
              app.flyTo(ll);
            }
          }}
        >
          {app.locating ? "Finding you…" : "My location"}
        </SecondaryButton>
        <SecondaryButton icon={<Search className="h-4 w-4" aria-hidden />} onClick={() => app.openPicker("report")}>
          Search
        </SecondaryButton>
      </div>
      {app.locError ? (
        <p className="text-small text-app-amber" role="alert">
          {app.locError}
        </p>
      ) : null}
    </div>
  );
}

function CategoryStep({ app }: { app: AppModel }) {
  const f = app.report;
  const name = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Barrier type</legend>
      <p className="pb-1 text-small text-app-muted">{f.location?.label ?? (f.location ? coords(f.location.lat, f.location.lon) : "")}</p>
      {REPORT_FLOW_CATEGORIES.map((c) => {
        const on = f.category === c.id;
        return (
          <label key={c.id} className={`cm-press flex min-h-[60px] cursor-pointer items-center gap-3 rounded-ctl border px-3.5 py-2.5 ${on ? "border-app-select bg-[var(--app-selected-bg)]" : "border-app-line hover:bg-app-chip"}`}>
            <input type="radio" name={name} value={c.id} checked={on} onChange={() => f.setCategory(c.id)} className="sr-only" />
            <span aria-hidden className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${on ? "border-app-accent bg-app-accent text-app-on-accent" : "border-app-line-strong"}`}>
              {on ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium">{categoryLabel(c.id)}</span>
              <span className="block text-small text-app-muted">{c.hint}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function DetailsStep({ app }: { app: AppModel }) {
  const f = app.report;
  const id = useId();
  const left = DESCRIPTION_MAX - f.description.length;
  return (
    <div className="space-y-3">
      <label htmlFor={id} className="block text-body font-medium">
        What should people know? <span className="font-normal text-app-muted">(optional)</span>
      </label>
      <textarea
        id={id}
        value={f.description}
        onChange={(e) => {
          f.setDescription(e.target.value.slice(0, DESCRIPTION_MAX + 20));
          f.setError(null);
        }}
        rows={4}
        maxLength={DESCRIPTION_MAX + 20}
        aria-describedby={`${id}-help ${id}-count${f.error ? ` ${id}-error` : ""}`}
        aria-invalid={left < 0 || !!f.error || undefined}
        placeholder="e.g. Ramp at the northeast corner is missing; wheelchairs have to use the driveway."
        className="w-full resize-none rounded-ctl border border-app-line-strong bg-app-surface px-3.5 py-3 text-body text-app-ink placeholder:text-app-muted focus-visible:border-app-ink"
      />
      {f.error ? (
        <p id={`${id}-error`} className="text-small font-medium text-app-red" role="alert">
          {f.error}
        </p>
      ) : null}
      <div className="flex items-start justify-between gap-3 text-small">
        <p id={`${id}-help`} className="text-app-muted">
          No names, phone numbers, emails or links.
        </p>
        <p id={`${id}-count`} className={`t-num shrink-0 ${left < 0 ? "font-semibold text-app-red" : "text-app-muted"}`}>
          {left < 0 ? `${-left} over` : `${left} left`}
        </p>
      </div>
      <p className="flex items-start gap-2 text-small text-app-muted">
        <CameraOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Photos aren&rsquo;t collected: reports stay anonymous and hold no images. Describe what you see instead.
      </p>
    </div>
  );
}

function ReviewStep({ app }: { app: AppModel }) {
  const f = app.report;
  const row = (label: string, value: React.ReactNode, to: ReportStep) => (
    <li className="flex items-start gap-3 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-small text-app-muted">{label}</span>
        <span className="block text-body font-medium [overflow-wrap:anywhere]">{value}</span>
      </span>
      <button type="button" onClick={() => f.setStep(to)} aria-label={`Change ${label.toLowerCase()}`} className="cm-press inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-chip px-2.5 text-small font-medium text-app-route hover:bg-app-chip">
        <Pencil className="h-3.5 w-3.5" aria-hidden /> Change
      </button>
    </li>
  );
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-app-line rounded-surface border border-app-line bg-app-surface px-4">
        {row(
          "Where",
          <>
            {f.location?.label ?? "A point on the map"}
            {f.location ? <span className="t-num block text-small font-normal text-app-muted">{coords(f.location.lat, f.location.lon)}</span> : null}
          </>,
          "location",
        )}
        {row("Barrier", f.category ? categoryLabel(f.category) : "Not chosen", "category")}
        {row("Note", f.description.trim() ? `“${f.description.trim()}”` : <span className="font-normal text-app-muted">None</span>, "details")}
      </ul>
      <p className="flex items-start gap-2 text-small text-app-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Sent anonymously. Anyone can see this report on the Community map; it is not sent to the city.
      </p>
      {f.error ? (
        <StateMessage tone="error" icon={null} title="Your report wasn't sent">
          {f.error}
        </StateMessage>
      ) : null}
    </div>
  );
}

function DoneStep({ app }: { app: AppModel }) {
  const f = app.report;
  const r = f.saved;
  if (!r) return null;
  return (
    <div className="space-y-4" role="status">
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-app-accent text-app-on-accent">
          <CircleCheck className="h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="t-component">{categoryLabel(r.category)}</p>
          <p className="text-small text-app-muted">{r.locationLabel ?? coords(r.lat, r.lon)}</p>
        </div>
      </div>
      <p className="text-body text-app-muted">
        Saved at {new Date(r.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}. It is on the Community map now, marked Unconfirmed until two other people say they see it too.
      </p>
      <SecondaryButton className="w-full" onClick={() => f.reset()}>
        Report another barrier
      </SecondaryButton>
    </div>
  );
}

/** The step's one action, pinned at the foot of the sheet or panel. */
export function ReportFooter({ app }: { app: AppModel }) {
  const f = app.report;
  switch (f.step) {
    case "location": {
      const pin = app.reportPin;
      return (
        <PrimaryButton
          disabled={!pin}
          onClick={() => {
            if (!pin) return;
            if (pin.lon < -85.65 || pin.lon > -80.8 || pin.lat < 30.33 || pin.lat > 35.03) {
              app.toast("That point is outside Georgia. CrossMetric takes reports in Georgia only.");
              return;
            }
            f.setLocation({ lon: pin.lon, lat: pin.lat, label: pin.label, source: "map" });
            f.setStep("category");
            app.setSnap("full");
          }}
        >
          Use this location
        </PrimaryButton>
      );
    }
    case "category":
      return (
        <PrimaryButton
          disabled={!f.category}
          onClick={() => {
            f.setStep("details");
            // The note and the review need the room (and the keyboard): open the sheet fully.
            app.setSnap("full");
          }}
        >
          {f.category ? "Continue" : "Choose a barrier type"}
        </PrimaryButton>
      );
    case "details":
      return (
        <PrimaryButton
          onClick={() => {
            const problem = f.check();
            if (problem) {
              f.setError(problem);
              app.setSnap("full");
            } else {
              f.setStep("review");
              app.setSnap("full");
            }
          }}
        >
          {f.description.trim() ? "Review" : "Skip and review"}
        </PrimaryButton>
      );
    case "review":
      return (
        <PrimaryButton
          busy={f.submitting}
          disabled={f.submitting}
          onClick={async () => {
            const saved = await f.submit();
            if (saved) app.community.upsert(saved);
          }}
        >
          {f.submitting ? "Sending…" : "Send report"}
        </PrimaryButton>
      );
    case "done":
      return f.saved ? <PrimaryButton onClick={() => app.go({ kind: "community", reportId: f.saved!.id }, "half")}>See it in Community</PrimaryButton> : null;
  }
}
