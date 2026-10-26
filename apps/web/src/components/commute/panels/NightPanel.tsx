"use client";

import { ArrowLeft, ExternalLink, Phone } from "lucide-react";
import { addDays, hhmm, localDate, localMinutes, weekdayOf, zonedToUtc } from "@crossmetric/engine/commute";
import type { NightService } from "@/lib/commute-types";
import { clock, tz } from "../format";
import type { AppModel } from "../model";
import { IconButton, LinkButton } from "../ui";
import { Disclosure, SourceLinks } from "./common";

type Status = { tone: "teal" | "gray"; text: string };

/** Operating status from published weekly windows (no holiday data: shown separately). */
function statusOf(s: NightService, now: number): Status | null {
  if (!s.windows?.length) return null;
  const today = localDate(now, tz);
  const minute = localMinutes(now, tz);
  const wd = weekdayOf(today);
  for (const w of s.windows) {
    const start = hhmm(w.start);
    let end = hhmm(w.end);
    if (w.days.includes(wd) && minute >= start && minute < end) {
      let endDate = today;
      // A window that runs to midnight continues into one that starts at midnight the next day.
      if (end >= 1440) {
        const next = addDays(today, 1);
        const cont = s.windows.find((x) => x.days.includes(weekdayOf(next)) && hhmm(x.start) === 0);
        endDate = next;
        end = cont ? hhmm(cont.end) : 0;
      }
      return { tone: "teal", text: `Operating until ${clock(zonedToUtc(endDate, end, tz))}` };
    }
  }
  for (let d = 0; d < 7; d++) {
    const date = addDays(today, d);
    const day = weekdayOf(date);
    const starts = s.windows
      .filter((w) => w.days.includes(day))
      .map((w) => hhmm(w.start))
      .filter((m) => d > 0 || m > minute)
      .sort((a, b) => a - b);
    if (starts.length) {
      const t = zonedToUtc(date, starts[0]!, tz);
      return { tone: "gray", text: `Starts ${d === 0 ? "" : d === 1 ? "tomorrow " : ""}${clock(t)}` };
    }
  }
  return null;
}

export function NightPanel({ app }: { app: AppModel }) {
  const services = app.bundle?.night ?? [];
  const help = app.bundle?.help ?? [];
  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-start gap-1">
        <IconButton label="Back" onClick={() => window.history.back()} className="-ml-2">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </IconButton>
        <div className="min-w-0">
          <h2 className="t-section">Night travel</h2>
          <p className="text-small text-app-muted">Official services and how to request them</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Help">
        {help.map((h) => (
          <LinkButton key={h.phone} href={`tel:${h.phone}`} icon={<Phone className="h-4 w-4" aria-hidden />} className="flex-1 !min-h-[44px] text-small" aria-label={`Call ${h.label}: ${h.display}`}>
            {h.label} · {h.display}
          </LinkButton>
        ))}
      </div>
      {help.some((h) => h.detail) ? <p className="text-small text-app-muted">{help.find((h) => h.detail)!.detail}</p> : null}

      <ul className="divide-y divide-app-line">
        {services.map((s) => {
          const st = statusOf(s, app.now);
          return (
            <li key={s.id} className="py-4 first:pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <p className="t-component">{s.name}</p>
                {st ? <span className={`text-small font-medium ${st.tone === "teal" ? "text-app-teal" : "text-app-muted"}`}>{st.text}</span> : null}
              </div>
              <p className="text-small text-app-muted">{s.summary}</p>
              {app.snap !== "rest" ? (
                <div className="mt-1 space-y-0.5 text-small text-app-muted">
                  {s.eligibility ? <p>{s.eligibility}</p> : null}
                  {s.routes ? <p>Routes {s.routes.join(", ")}</p> : null}
                  {s.limits?.map((l) => (
                    <p key={l}>{l}</p>
                  ))}
                  {s.pickup ? <p>{s.pickup}</p> : null}
                  {s.exceptions ? <p className="text-app-amber">{s.exceptions}</p> : null}
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {s.handoffs.map((h) => (
                  <LinkButton key={h.url} href={h.url} className="flex-1 whitespace-nowrap !px-3 text-small" icon={h.url.startsWith("tel:") ? <Phone className="h-4 w-4" aria-hidden /> : <ExternalLink className="h-4 w-4" aria-hidden />}>
                    {h.label}
                  </LinkButton>
                ))}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-small text-app-muted">CrossMetric doesn&rsquo;t have lighting data for walking paths, can&rsquo;t judge safety, and doesn&rsquo;t monitor or dispatch help.</p>

      {app.snap !== "rest" ? (
        <Disclosure summary="Sources">
          <SourceLinks sources={app.bundle?.sources ?? {}} ids={[...new Set([...services.map((s) => s.sourceId), ...help.map((h) => h.sourceId)])]} />
        </Disclosure>
      ) : null}
    </div>
  );
}
