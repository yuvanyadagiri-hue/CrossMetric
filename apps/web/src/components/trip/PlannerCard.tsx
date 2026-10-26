"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ArrowRight, ArrowUpDown, CalendarClock, Circle, MapPin } from "lucide-react";
import { instantToLocalInputs, suggestedTime } from "@crossmetric/engine/commute";
import { PlaceCombobox } from "@/components/search/PlaceCombobox";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/primitives";
import type { Place } from "@/lib/trip-types";
import { ModeIcon, MODE_LABEL, PLANNER_MODE_ORDER } from "./modeMeta";
import type { TripPlanner } from "./useTripPlanner";

/**
 * The route planner: from, to, when and mode. Safety is the differentiator,
 * so the primary action is "Find safer routes".
 */
export function PlannerCard({ planner, compact = false, onSubmitted }: { planner: TripPlanner; compact?: boolean; onSubmitted?: () => void }) {
  const router = useRouter();
  const [tab, setTab] = useState<"plan" | "explore">("plan");
  const [missing, setMissing] = useState<string | null>(null);
  const whenId = useId();
  const loading = planner.trip.status === "loading" || planner.modes.status === "loading";

  const submit = () => {
    if (!planner.from || !planner.to) {
      setMissing(!planner.from ? "Choose where you are starting from." : "Choose a destination.");
      return;
    }
    setMissing(null);
    planner.run();
    onSubmitted?.();
  };

  const explore = (p: Place) => {
    if ((p.kind === "school" || p.kind === "college") && p.id) router.push(`/schools/${p.id}`);
    else router.push(`/map?focus=${p.lon.toFixed(5)},${p.lat.toFixed(5)}`);
  };

  return (
    <div className="card p-4 shadow-[var(--shadow-pop)] sm:p-5" data-trip-planner>
      {!compact ? (
        <div className="-mt-1 mb-4">
          <Tabs
            label="Planner"
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "plan", label: "Plan a trip" },
              { id: "explore", label: "Explore a place" },
            ]}
          />
        </div>
      ) : null}

      {tab === "explore" ? (
        <div className="space-y-3">
          <PlaceCombobox label="School, college, or place" visibleLabel value={null} onSelect={explore} placeholder="Search a school, college, or address…" />
          <p className="text-small text-ink-muted">Open a school or college profile, or see crashes, roads and reports around any Georgia place.</p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          aria-label="Plan a trip"
        >
          <div className={`grid gap-3 ${compact ? "" : "md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_200px]"} items-end`}>
            <PlaceCombobox
              label="From"
              visibleLabel
              value={planner.from}
              onSelect={(p) => planner.setFrom(p)}
              onUseLocation={() => planner.useMyLocation("from")}
              locating={planner.locating === "from"}
              placeholder="Starting point"
              leadingIcon={<Circle className="h-3.5 w-3.5 fill-navy-900 text-navy-900" aria-hidden />}
            />
            <button
              type="button"
              onClick={planner.swap}
              className={`grid h-11 w-11 shrink-0 place-items-center justify-self-center rounded-chip border border-line-strong bg-white text-ink-soft transition-colors hover:bg-subtle hover:text-navy-900 ${compact ? "-my-1.5 h-8 w-8" : ""}`}
              aria-label="Swap start and destination"
            >
              <ArrowUpDown className="h-4 w-4 md:rotate-90" aria-hidden />
            </button>
            <PlaceCombobox
              label="To"
              visibleLabel
              value={planner.to}
              onSelect={(p) => planner.setTo(p)}
              placeholder="School, college, or address"
              leadingIcon={<MapPin className="h-4 w-4 text-brand-600" aria-hidden />}
            />
            <div>
              <label htmlFor={whenId} className="mb-1.5 block text-small font-medium text-ink-muted">
                When
              </label>
              <div className="flex h-11 items-center gap-2 rounded-chip border border-line-strong bg-white px-3 focus-within:border-brand-500 focus-within:ring-[3px] focus-within:ring-brand-500/15">
                <CalendarClock className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
                {planner.when.kind === "now" ? (
                  <select
                    id={whenId}
                    className="h-full min-w-0 flex-1 appearance-none bg-transparent text-small font-medium text-ink outline-none"
                    value="now"
                    onChange={(e) => {
                      if (e.target.value === "at") {
                        // Georgia wall-clock time, whatever time zone this device is set to.
                        const { date, time } = instantToLocalInputs(suggestedTime(Date.now(), 30));
                        planner.setWhen({ kind: "at", local: `${date}T${time}` });
                      }
                    }}
                  >
                    <option value="now">Leave now</option>
                    <option value="at">Leave at…</option>
                  </select>
                ) : (
                  <>
                    <input
                      id={whenId}
                      type="datetime-local"
                      className="h-full min-w-0 flex-1 bg-transparent text-small font-medium text-ink outline-none"
                      value={planner.when.local}
                      onChange={(e) => planner.setWhen({ kind: "at", local: e.target.value })}
                    />
                    <button type="button" className="text-meta font-semibold text-brand-600 hover:text-brand-800" onClick={() => planner.setWhen({ kind: "now" })}>
                      Now
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className={`mt-4 flex flex-col gap-3 ${compact ? "" : "lg:flex-row lg:items-center"}`}>
            <div role="radiogroup" aria-label="Travel mode" className="flex flex-1 flex-wrap gap-2">
              {PLANNER_MODE_ORDER.map((m) => {
                const on = planner.mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    tabIndex={on ? 0 : -1}
                    data-mode={m}
                    onClick={() => planner.setMode(m)}
                    onKeyDown={(e) => {
                      if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
                      e.preventDefault();
                      const i = PLANNER_MODE_ORDER.indexOf(planner.mode);
                      const next = PLANNER_MODE_ORDER[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : PLANNER_MODE_ORDER.length - 1)) % PLANNER_MODE_ORDER.length]!;
                      planner.setMode(next);
                      (e.currentTarget.parentElement?.querySelector(`[data-mode="${next}"]`) as HTMLElement | null)?.focus();
                    }}
                    className={`inline-flex h-10 items-center gap-2 rounded-chip px-3.5 text-small font-semibold transition-[background-color,color,box-shadow] ${
                      on ? "bg-navy-900 text-white shadow-[0_1px_2px_rgb(7_27_51/0.2)]" : "bg-subtle text-ink-soft ring-1 ring-inset ring-line hover:bg-white hover:text-navy-900 hover:ring-line-strong"
                    }`}
                  >
                    <ModeIcon mode={m} />
                    {MODE_LABEL[m]}
                  </button>
                );
              })}
            </div>
            <Button type="submit" size="lg" loading={loading} trailingIcon={<ArrowRight className="h-4 w-4" aria-hidden />} className={compact ? "w-full" : "lg:min-w-[230px]"}>
              {loading ? "Analyzing route conditions…" : "Find safer routes"}
            </Button>
          </div>
          {missing || planner.locationError ? (
            <p role="alert" className="mt-3 text-small font-medium text-critical-fg">
              {missing ?? planner.locationError}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}
