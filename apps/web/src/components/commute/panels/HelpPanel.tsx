"use client";

import Link from "next/link";
import { BookOpen, ChevronDown, ChevronRight, Gauge, Lock, MapPinned, ShieldCheck, TrainFront, type LucideIcon } from "lucide-react";
import type { AppModel } from "../model";
import { PanelHeader } from "../ui";

interface Topic {
  id: string;
  Icon: LucideIcon;
  title: string;
  body: React.ReactNode;
}

const TOPICS: Topic[] = [
  {
    id: "ranking",
    Icon: Gauge,
    title: "How are the options chosen?",
    body: (
      <>
        <p>One search compares walking, biking, transit, driving, park and ride, and a ride-hail hand-off for the same trip, then lists them side by side.</p>
        <p>
          <strong>Fastest</strong> is the quickest door to door. <strong>Cheapest</strong> is the lowest known cost, and it is only shown when no option with an unknown cost could be cheaper. Other tags (less walking, fewer transfers) appear only when an option clearly differs from the rest.
        </p>
        <p>Nothing is hidden to push one choice: options your preferences left out are listed with the reason.</p>
      </>
    ),
  },
  {
    id: "times",
    Icon: TrainFront,
    title: "Where do times and costs come from?",
    body: (
      <>
        <p>Walking, biking and driving use OpenStreetMap routing. Transit uses published timetables (MARTA, UGA buses and Athens-Clarke County transit), not live vehicle positions.</p>
        <p>Driving has no live traffic, so a planning buffer is added and shown on the trip. Costs appear only when they are known: transit fares, gas when you enter your mpg and a gas price, and campus parking from verified rules.</p>
      </>
    ),
  },
  {
    id: "crossscore",
    Icon: ShieldCheck,
    title: "What is CrossScore?",
    body: (
      <>
        <p>
          CrossScore compares the crash history along a route (Georgia DOT records for roughly the last three years) with typical roads of the same kind. It runs from 0 to 100, and a higher number means fewer recorded crashes than typical.
        </p>
        <p>It describes street conditions. It is not live, it does not predict crashes, and transit rides are not scored.</p>
        <p>
          The full method is on the <Link href="/methodology" className="font-semibold underline">Methodology page</Link>.
        </p>
      </>
    ),
  },
  {
    id: "parking",
    Icon: MapPinned,
    title: "How reliable are campus parking rules?",
    body: (
      <>
        <p>Georgia Tech and UGA parking rules are read from the schools&rsquo; own pages and entered by hand, each with the date it was checked and a date to check it again.</p>
        <p>When a record is out of date or the school publishes no rule for that time, CrossMetric says &ldquo;Rules unknown&rdquo; instead of guessing. Always follow the signs at the lot.</p>
      </>
    ),
  },
  {
    id: "privacy",
    Icon: Lock,
    title: "What stays on my device?",
    body: (
      <>
        <p>There is no account. Your saved places, past trips, settings, classes and parked car stay in this browser.</p>
        <p>Your location is used only when you ask, and it is not stored. Searching for a route sends the start and destination to CrossMetric&rsquo;s server to plan it, and nothing is kept there. Trip links you share never include your current location.</p>
      </>
    ),
  },
];

/** Help, as in the Uber app: short answers to what people wonder about, with no sign-in and no forms. */
export function HelpPanel({ app }: { app: AppModel }) {
  return (
    <div className="space-y-6 pt-1">
      <PanelHeader title={<span className="t-page">Help</span>} sub="How CrossMetric works, in plain words." onBack={app.back} />

      <ul className="divide-y divide-app-line border-y border-app-line">
        {TOPICS.map((t) => (
          <li key={t.id}>
            <details className="cm-help group">
              <summary className="cm-press flex min-h-[60px] cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
                <span className="grid h-10 w-10 shrink-0 place-items-center text-app-ink" aria-hidden>
                  <t.Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1 text-body font-medium leading-snug">{t.title}</span>
                <ChevronDown className="h-5 w-5 shrink-0 text-app-muted transition-transform duration-200 group-open:rotate-180" aria-hidden />
              </summary>
              <div className="space-y-2.5 pb-4 pl-[52px] text-body text-app-muted [&_strong]:font-semibold [&_strong]:text-app-ink">{t.body}</div>
            </details>
          </li>
        ))}
      </ul>

      <Link href="/methodology" className="cm-press flex min-h-[60px] items-center gap-3 text-left">
        <span className="grid h-10 w-10 shrink-0 place-items-center text-app-ink" aria-hidden>
          <BookOpen className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-medium">Methodology and sources</span>
          <span className="block text-small text-app-muted">The data and math behind CrossMetric</span>
        </span>
        <ChevronRight className="h-[18px] w-[18px] shrink-0 text-app-muted" aria-hidden />
      </Link>
    </div>
  );
}
