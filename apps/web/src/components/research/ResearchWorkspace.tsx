"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BacklogDraft, RunReport } from "@crossmetric/engine/research";

interface SourceEntry {
  id: string;
  owner: string;
  status: string;
  access: string;
  reason: string | null;
  retention: string;
}

interface Review {
  clusterId: string;
  decision: string;
  note: string;
  at: string;
}

export function SignIn() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <form
      className="mt-6 flex max-w-[420px] flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const res = await fetch("/api/research/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
        if (res.ok) router.refresh();
        else setError("That token didn't work.");
      }}
    >
      <label htmlFor="token" className="text-small font-medium">
        Internal token
      </label>
      <input id="token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className="input" />
      <button type="submit" className="btn-primary w-fit">
        Sign in
      </button>
      {error ? <p className="text-small text-critical-fg">{error}</p> : null}
    </form>
  );
}

export function ResearchWorkspace({
  registry,
  run,
  reviews,
  evidence,
}: {
  registry: { updated: string; sources: SourceEntry[] };
  run: { report: RunReport; drafts: BacklogDraft[] } | null;
  reviews: Review[];
  evidence: Record<string, { text: string; postedAt: string; campus: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const reviewOf = new Map(reviews.map((r) => [r.clusterId, r]));

  const runNow = async () => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/research/run", { method: "POST" });
    setBusy(false);
    setMsg(res.ok ? "Batch finished." : ((await res.json().catch(() => null))?.error ?? "Run failed."));
    router.refresh();
  };
  const review = async (clusterId: string, decision: string) => {
    const note = decision === "accept" ? "" : (window.prompt("Note (optional)") ?? "");
    await fetch("/api/research/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clusterId, decision, note }) });
    router.refresh();
  };

  return (
    <div className="mt-6 space-y-8">
      <section aria-labelledby="sources-h">
        <h2 id="sources-h" className="text-component font-semibold">
          Sources
        </h2>
        <p className="text-small text-ink-soft">Registry updated {registry.updated}. A source runs only when it is enabled there.</p>
        <table className="mt-2 w-full text-left text-small">
          <thead>
            <tr className="border-b border-line">
              <th className="py-1.5 pr-3">Source</th>
              <th className="py-1.5 pr-3">Status</th>
              <th className="py-1.5">Why / access</th>
            </tr>
          </thead>
          <tbody>
            {registry.sources.map((s) => (
              <tr key={s.id} className="border-b border-line align-top">
                <td className="py-1.5 pr-3 font-medium">{s.owner}</td>
                <td className="py-1.5 pr-3">{s.status.replace("_", " ")}</td>
                <td className="py-1.5">{s.reason ?? s.access}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="run-h">
        <div className="flex items-center gap-3">
          <h2 id="run-h" className="text-component font-semibold">
            Latest batch
          </h2>
          <button type="button" onClick={runNow} disabled={busy} className="btn btn-secondary btn-sm">
            {busy ? "Running…" : "Run batch now"}
          </button>
          {msg ? <span className="text-small text-ink-soft">{msg}</span> : null}
        </div>
        {run ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-small sm:grid-cols-4">
            {(
              [
                ["Started", run.report.startedAt.replace("T", " ").slice(0, 16)],
                ["Records in", run.report.input],
                ["Outside window", run.report.excludedOutOfWindow],
                ["Over cap", run.report.excludedOverCap],
                ["Exact duplicates", run.report.exactDuplicates],
                ["Near duplicates", run.report.nearDuplicates],
                ["Invalid extractions", run.report.invalidExtractions],
                ["Drafts", run.report.drafts],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-ink-soft">{k}</dt>
                <dd className="font-medium tabular">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-2 text-small text-ink-soft">No batch has run yet.</p>
        )}
      </section>

      <section aria-labelledby="drafts-h">
        <h2 id="drafts-h" className="text-component font-semibold">
          Drafts for review
        </h2>
        {run?.drafts.length ? (
          <ul className="mt-2 space-y-3">
            {run.drafts.map((d) => {
              const r = reviewOf.get(d.cluster_id);
              return (
                <li key={d.cluster_id} className="rounded-ctl border border-line bg-white p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-body font-semibold">{d.title}</p>
                    <span className="text-meta text-ink-soft">
                      {d.campus} · priority {d.priority.score} (provisional) · confidence {d.confidence}
                    </span>
                  </div>
                  <p className="mt-1 text-small">{d.problem_summary}</p>
                  <p className="mt-1 text-small text-ink-soft">Proposed: {d.proposed_user_story}</p>
                  <details className="mt-2 text-small">
                    <summary className="cursor-pointer font-medium">Evidence ({d.evidence_ids.length})</summary>
                    <ul className="mt-1 space-y-1">
                      {d.evidence_ids.map((id) => (
                        <li key={id} className="rounded bg-subtle px-2 py-1">
                          {/* Collected text is shown as plain text only. */}
                          <span className="text-ink-soft">{evidence[id]?.postedAt.slice(0, 10) ?? "expired"} · </span>
                          {evidence[id]?.text ?? "Evidence removed or expired"}
                        </li>
                      ))}
                    </ul>
                  </details>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {(["accept", "merge", "reject", "needs_evidence"] as const).map((dec) => (
                      <button key={dec} type="button" onClick={() => review(d.cluster_id, dec)} className={`btn btn-sm ${r?.decision === dec ? "btn-primary" : "btn-secondary"}`}>
                        {dec.replace("_", " ")}
                      </button>
                    ))}
                    {r ? <span className="text-meta text-ink-soft">Reviewed {r.at.slice(0, 10)}{r.note ? ` · ${r.note}` : ""}</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-small text-ink-soft">No drafts. Drafts appear after a batch finds feedback.</p>
        )}
      </section>
    </div>
  );
}
