import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BarChart3, ClipboardList, GitCompareArrows, Layers, ListOrdered, Map as MapIcon, Scale, SearchCheck } from "lucide-react";
import { formatDate, formatInt, MODEL } from "@crossmetric/engine";
import { SchoolSearch } from "@/components/search/SchoolSearch";
import { Card } from "@/components/ui/Card";
import { getRepository } from "@/server/repository";

export const metadata: Metadata = { title: "Analyze" };

const CAPABILITIES = [
  { icon: ListOrdered, title: "Ranked locations", text: "Every intersection and road segment near a school, ranked by Priority for Review (0–100) with its rank and band." },
  { icon: SearchCheck, title: "Evidence review", text: "Why a location ranks where it does: score breakdown, percentiles, crash records with GEARS report IDs, traffic and provenance." },
  { icon: Scale, title: "Scenarios & sensitivity", text: "Re-weight the model (pedestrian, injury or crash emphasis) and see how stable each ranking is across scenarios." },
  { icon: Layers, title: "Filters", text: "Change the analysis radius, the time period and the crash filter (injury, pedestrian-involved, low-light); everything recomputes instantly." },
  { icon: GitCompareArrows, title: "Compare locations", text: "Put up to four locations side by side on every indicator." },
  { icon: ClipboardList, title: "Resource Planner", text: "Enter how many professional reviews are possible and get the highest-priority distinct locations to start with." },
];

export default async function AnalyzePage() {
  const repo = getRepository();
  const [index, colleges, meta] = await Promise.all([repo.getSchoolIndex(), repo.getCollegeIndex(), repo.getMeta()]);
  return (
    <div className="pb-16">
      <section className="border-b border-line bg-white">
        <div className="mx-auto grid w-full max-w-[1280px] gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <p className="eyebrow">Analyze · for planners, schools and districts</p>
            <h1 className="mt-3 text-page font-semibold leading-[1.1] text-navy-900 sm:text-display">Where should transportation safety be improved?</h1>
            <p className="mt-4 max-w-[560px] text-body leading-relaxed text-ink-soft">
              CrossMetric ranks the roads and intersections around a school by <strong className="font-semibold text-navy-900">Priority for Review</strong>: where historical crash evidence, traffic and
              proximity stand out most, so professionals know where to look first. It is explainable decision support, not a prediction.
            </p>
            <div className="mt-6 max-w-[560px]">
              <SchoolSearch autoFocus size="lg" placeholder="Search a Georgia school or college…" />
            </div>
            <p className="mt-3 text-small text-ink-muted">
              {formatInt(index.schools.length)} public schools and {formatInt(colleges?.schools.length ?? 0)} colleges · crash data {formatDate(meta.window.start)} – {formatDate(meta.window.end)} · model v{MODEL.version}
            </p>
          </div>
          <Card className="p-6">
            <p className="eyebrow">Priority for Review bands</p>
            <ul className="mt-3 space-y-2.5">
              {MODEL.bands.map((b) => (
                <li key={b.id} className="flex items-center gap-3 text-small">
                  <span
                    className={`tabular inline-flex h-7 w-11 items-center justify-center rounded-chip text-small font-semibold ${
                      b.id === "high" ? "bg-priority-high text-white" : b.id === "elevated" ? "bg-priority-elevated text-navy-950" : b.id === "moderate" ? "bg-priority-moderate text-navy-950" : "bg-priority-lower-bg text-ink-soft"
                    }`}
                  >
                    {b.min}+
                  </span>
                  <span className="font-medium text-navy-900">{b.label}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 border-t border-line pt-3 text-meta leading-relaxed text-ink-muted">
              Scores are percentiles among the locations around the same school, so a high priority means the evidence stands out locally — not that a road is unsafe. See the{" "}
              <Link href="/methodology#scoring" className="link">
                methodology
              </Link>
              .
            </p>
          </Card>
        </div>
      </section>

      <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6">
        <section className="mt-10" aria-labelledby="cap-title">
          <h2 id="cap-title" className="text-component font-semibold text-navy-900">
            What you can do in a school analysis
          </h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <li key={c.title} className="card p-5">
                <span className="grid h-9 w-9 place-items-center rounded-chip bg-brand-50 text-brand-600" aria-hidden>
                  <c.icon className="h-4 w-4" />
                </span>
                <h3 className="mt-3 text-body font-semibold text-navy-900">{c.title}</h3>
                <p className="mt-1 text-small leading-relaxed text-ink-muted">{c.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-2" aria-label="More analysis">
          <Link href="/map" className="card card-interactive group flex items-center gap-4 p-5">
            <span className="grid h-11 w-11 place-items-center rounded-ctl bg-navy-900 text-white" aria-hidden>
              <MapIcon className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="block text-body font-semibold text-navy-900">Statewide map</span>
              <span className="block text-small text-ink-muted">Crash density, High Injury Network, transit, schools and community reports.</span>
            </span>
            <ArrowRight className="h-4 w-4 text-ink-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
          <Link href="/schools/compare" className="card card-interactive group flex items-center gap-4 p-5">
            <span className="grid h-11 w-11 place-items-center rounded-ctl bg-navy-900 text-white" aria-hidden>
              <BarChart3 className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="block text-body font-semibold text-navy-900">Compare institutions</span>
              <span className="block text-small text-ink-muted">Road conditions, crash patterns and priority locations around two or three schools.</span>
            </span>
            <ArrowRight className="h-4 w-4 text-ink-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </section>
      </div>
    </div>
  );
}
