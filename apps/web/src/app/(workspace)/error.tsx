"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-[600px] px-6 py-24 text-center">
      <p className="eyebrow">Something went wrong</p>
      <h1 className="mt-2 text-section font-semibold text-navy-900">CrossMetric couldn’t load this analysis.</h1>
      <p className="mt-2 text-small text-ink-soft">{error.message.includes("pipeline") ? error.message : "The data service did not respond as expected."}</p>
      <button type="button" onClick={reset} className="btn-primary mt-6">
        Try again
      </button>
    </div>
  );
}
