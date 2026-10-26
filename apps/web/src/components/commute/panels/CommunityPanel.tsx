"use client";

import { useState } from "react";
import Link from "next/link";
import { BadgeCheck, BarChart3, ChevronRight, CircleCheck, CircleDashed, Info, MapPinPlus, RefreshCw, ServerCrash, TriangleAlert, UsersRound } from "lucide-react";
import { categoryLabel, reportStatus, timeAgo, verificationLevel, type CommunityReport } from "@/lib/reports";
import type { AppModel } from "../model";
import { castVote, readVotes } from "../useCommunity";
import { PanelHeader, PrimaryButton, SecondaryButton, StateMessage } from "../ui";
import { Disclosure } from "./common";

type Filter = "open" | "fixed" | "all";

/**
 * A report's standing, in words: "Unconfirmed" when only its author has seen it, "Confirmed" once
 * two other people tapped "I see this too", "Reported fixed" once two people said it is fixed.
 * None of these is official verification, and the badge says so in its title.
 */
export function ReportStatusBadge({ report, compact }: { report: CommunityReport; compact?: boolean }) {
  const fixed = reportStatus(report) === "reported-fixed";
  const confirmed = verificationLevel(report) === "community-confirmed";
  const { cls, Icon, word, title } = fixed
    ? { cls: "bg-app-gray-bg text-app-gray", Icon: CircleCheck, word: "Reported fixed", title: "Two or more people reported this fixed. Not an official inspection." }
    : confirmed
      ? { cls: "bg-app-amber-bg text-app-amber", Icon: BadgeCheck, word: compact ? "Confirmed" : `Confirmed by ${report.confirmations}`, title: "Two or more other people said they see this too. Not official verification." }
      : { cls: "bg-app-chip text-app-muted", Icon: CircleDashed, word: "Unconfirmed", title: "Only the person who reported it has seen it so far." };
  return (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-tag px-2 py-0.5 text-meta font-semibold ${cls}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {word}
    </span>
  );
}

/** One report in a list: the barrier, where and when, and its standing. */
export function ReportRow({ report: r, detail, onClick }: { report: CommunityReport; detail: string; onClick: () => void }) {
  const open = reportStatus(r) === "open";
  return (
    <button type="button" onClick={onClick} className="cm-press flex min-h-[64px] w-full items-start gap-3 py-2.5 text-left">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${open ? "bg-app-amber-bg text-app-amber" : "bg-app-gray-bg text-app-gray"}`}>
        {open ? <TriangleAlert className="h-5 w-5" aria-hidden /> : <CircleCheck className="h-5 w-5" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium leading-snug">{categoryLabel(r.category)}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-app-muted">
          <ReportStatusBadge report={r} compact />
          <span className="min-w-0 truncate">{detail}</span>
        </span>
      </span>
      <ChevronRight className="mt-2.5 h-4 w-4 shrink-0 text-app-muted" aria-hidden />
    </button>
  );
}

/** Community: the barriers people reported, on the map and in a list, and how they become confirmed. */
export function CommunityPanel({ app }: { app: AppModel }) {
  const id = app.view.kind === "community" ? (app.view.reportId ?? null) : null;
  if (id) return <ReportDetail app={app} id={id} />;
  return <ReportList app={app} />;
}

function ReportList({ app }: { app: AppModel }) {
  const [filter, setFilter] = useState<Filter>("open");
  const c = app.community;
  const all = c.reports ?? [];
  const open = all.filter((r) => reportStatus(r) === "open");
  const fixed = all.filter((r) => reportStatus(r) === "reported-fixed");
  const shown = filter === "open" ? open : filter === "fixed" ? fixed : all;
  const confirmed = open.filter((r) => verificationLevel(r) === "community-confirmed").length;

  return (
    <div className="space-y-5 pb-2 pt-1">
      <PanelHeader title="Community" sub="Sidewalk and crossing barriers reported by people who use these streets. Anonymous, and not official city data." />

      {c.reports ? (
        <dl className="grid grid-cols-3 divide-x divide-app-line rounded-surface border border-app-line" aria-label="Report counts">
          <Stat label="Open" value={open.length} />
          <Stat label="Confirmed" value={confirmed} />
          <Stat label="Reported fixed" value={fixed.length} />
        </dl>
      ) : null}

      <div className="flex gap-1.5" role="radiogroup" aria-label="Show">
        {(
          [
            ["open", `Open${c.reports ? ` · ${open.length}` : ""}`],
            ["fixed", "Reported fixed"],
            ["all", "All"],
          ] as [Filter, string][]
        ).map(([f, label]) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={filter === f}
            onClick={() => setFilter(f)}
            className={`cm-press inline-flex min-h-[40px] items-center rounded-chip px-3.5 text-small font-medium ${filter === f ? "bg-[var(--app-selected-bg)] text-app-ink shadow-[inset_0_0_0_1.5px_var(--app-select)]" : "bg-app-chip text-app-muted hover:bg-app-chip-hover hover:text-app-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {c.error && !c.reports ? (
        <StateMessage tone="error" icon={<ServerCrash className="h-5 w-5" />} title="Reports couldn't be loaded" action={<SecondaryButton onClick={c.refresh}>Try again</SecondaryButton>}>
          {c.error}
        </StateMessage>
      ) : !c.reports ? (
        <ul aria-busy="true" aria-label="Loading reports" className="space-y-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 py-1">
              <span className="cm-shimmer h-10 w-10 rounded-full" />
              <span className="flex flex-1 flex-col gap-2">
                <span className="cm-shimmer h-4 w-1/2 rounded-tag" />
                <span className="cm-shimmer h-3.5 w-3/4 rounded-tag" />
              </span>
            </li>
          ))}
        </ul>
      ) : shown.length ? (
        <ul className="divide-y divide-app-line" aria-label="Reports, newest first">
          {shown.map((r) => (
            <li key={r.id}>
              <ReportRow report={r} detail={`${r.locationLabel ?? "Pinned on the map"} · ${timeAgo(r.createdAt, app.now)}`} onClick={() => app.go({ kind: "community", reportId: r.id }, "half")} />
            </li>
          ))}
        </ul>
      ) : (
        <StateMessage icon={<UsersRound className="h-5 w-5" />} title={filter === "fixed" ? "Nothing reported fixed yet" : "No open reports yet"}>
          {filter === "fixed" ? "When two people say a barrier is fixed, it moves here." : "Reports appear here and on the map as soon as the server accepts them."}
        </StateMessage>
      )}

      {c.reports ? (
        <button type="button" onClick={c.refresh} className="inline-flex min-h-[40px] items-center gap-1.5 text-small font-medium text-app-muted hover:text-app-ink" aria-busy={c.loading || undefined}>
          <RefreshCw className={`h-4 w-4 ${c.loading ? "animate-spin" : ""}`} aria-hidden /> {c.loading ? "Refreshing…" : "Refresh"}
        </button>
      ) : null}

      <Disclosure summary="How reports work">
        <ul className="list-disc space-y-1.5 pl-4">
          <li>Anyone can report a barrier at a point on the map. CrossMetric stores the category, the point, the nearest address and an optional note — no names, accounts, photos, emails or IP addresses.</li>
          <li>&ldquo;I see this too&rdquo; from two or more people marks a report Confirmed. &ldquo;It&rsquo;s fixed&rdquo; from two or more people marks it Reported fixed.</li>
          <li>These are community observations, not inspections. They help show where a sidewalk, curb ramp or crossing needs attention.</li>
        </ul>
      </Disclosure>

      <section aria-label="Data-driven safety review" className="space-y-1">
        <h3 className="t-component">From public crash data</h3>
        <ul className="divide-y divide-app-line">
          <li>
            <Link href="/analyze" className="cm-press flex min-h-[60px] items-center gap-3">
              <BarChart3 className="h-5 w-5 shrink-0 text-app-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium">Priority for Review near schools</span>
                <span className="block text-small text-app-muted">Roads near Georgia schools ranked from GDOT crash records</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-app-muted" aria-hidden />
            </Link>
          </li>
          <li>
            <Link href="/methodology" className="cm-press flex min-h-[60px] items-center gap-3">
              <Info className="h-5 w-5 shrink-0 text-app-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium">How CrossScore is calculated</span>
                <span className="block text-small text-app-muted">Methods, data sources and limits</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-app-muted" aria-hidden />
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-3 py-2.5">
      <dt className="text-meta text-app-muted">{label}</dt>
      <dd className="t-num t-section">{value}</dd>
    </div>
  );
}

function ReportDetail({ app, id }: { app: AppModel; id: string }) {
  const c = app.community;
  const r = c.reports?.find((x) => x.id === id) ?? null;
  const [voted, setVoted] = useState(() => readVotes()[id] ?? null);
  const [busy, setBusy] = useState<"confirm" | "fixed" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backToList = () => app.go({ kind: "community", reportId: null }, "half", true);

  if (!r) {
    if (!c.reports && !c.error) return <StateMessage busy title="Loading the report…" />;
    return (
      <div className="space-y-4 pt-1">
        <PanelHeader title="Report not found" onBack={backToList} />
        <StateMessage icon={<Info className="h-5 w-5" />} title="This report isn't in the list" action={<SecondaryButton onClick={backToList}>All reports</SecondaryButton>}>
          {c.error ?? "It may have been removed, or the link is incomplete."}
        </StateMessage>
      </div>
    );
  }

  const vote = async (kind: "confirm" | "fixed") => {
    setBusy(kind);
    setError(null);
    const res = await castVote(r.id, kind);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    c.upsert(res.report);
    setVoted(kind);
    app.toast(kind === "confirm" ? "Thanks. Your confirmation was counted." : "Thanks. Your “fixed” vote was counted.");
  };

  const created = new Date(r.createdAt);
  return (
    <div className="space-y-5 pb-2 pt-1">
      <PanelHeader title={categoryLabel(r.category)} sub={r.locationLabel ?? "Pinned on the map"} onBack={backToList} backLabel="All reports" />
      <div className="flex flex-wrap items-center gap-2">
        <ReportStatusBadge report={r} />
        <span className="text-small text-app-muted">
          Reported {timeAgo(r.createdAt, app.now)} · {created.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </span>
      </div>
      {r.description ? <p className="rounded-surface border border-app-line bg-app-surface px-4 py-3 text-body leading-relaxed [overflow-wrap:anywhere]">&ldquo;{r.description}&rdquo;</p> : <p className="text-small text-app-muted">No description was added.</p>}

      <dl className="grid grid-cols-2 gap-3 text-small">
        <div>
          <dt className="text-app-muted">People who see it too</dt>
          <dd className="t-num t-component">{r.confirmations}</dd>
        </div>
        <div>
          <dt className="text-app-muted">Said it&rsquo;s fixed</dt>
          <dd className="t-num t-component">{r.resolvedVotes}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-app-muted">Location</dt>
          <dd className="t-num">
            {r.lat.toFixed(5)}, {r.lon.toFixed(5)}
          </dd>
        </div>
      </dl>

      <section aria-label="Have you seen this?" className="space-y-2">
        <h3 className="t-component">Have you been here?</h3>
        {voted ? (
          <p className="flex items-center gap-2 text-small text-app-muted" role="status">
            <CircleCheck className="h-4 w-4 text-app-teal" aria-hidden />
            You {voted === "confirm" ? "confirmed this barrier" : "said this is fixed"} from this device.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <SecondaryButton onClick={() => void vote("confirm")} disabled={!!busy} aria-busy={busy === "confirm" || undefined}>
              {busy === "confirm" ? "Saving…" : "I see this too"}
            </SecondaryButton>
            <SecondaryButton onClick={() => void vote("fixed")} disabled={!!busy} aria-busy={busy === "fixed" || undefined}>
              {busy === "fixed" ? "Saving…" : "It's fixed"}
            </SecondaryButton>
          </div>
        )}
        {error ? (
          <p className="text-small font-medium text-app-red" role="alert">
            {error}
          </p>
        ) : null}
        <p className="text-meta text-app-muted">Votes are anonymous. Only vote for places you have seen yourself.</p>
      </section>

      <button type="button" onClick={() => app.openReport({ lon: r.lon, lat: r.lat, label: r.locationLabel })} className="cm-press flex min-h-[52px] w-full items-center gap-3 rounded-ctl text-left hover:bg-app-chip">
        <MapPinPlus className="h-5 w-5 shrink-0 text-app-muted" aria-hidden />
        <span className="min-w-0 flex-1 text-body font-medium">Report something else here</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-app-muted" aria-hidden />
      </button>
    </div>
  );
}

/** The one action on the Community list: report a barrier. */
export function CommunityFooter({ app }: { app: AppModel }) {
  if (app.view.kind !== "community" || app.view.reportId) return null;
  return (
    <PrimaryButton onClick={() => app.openReport()} icon={<MapPinPlus className="h-5 w-5" aria-hidden />}>
      Report a barrier
    </PrimaryButton>
  );
}
