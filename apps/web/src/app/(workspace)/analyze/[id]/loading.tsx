export default function Loading() {
  return (
    <div className="grid flex-1 grid-cols-1 lg:h-[calc(100dvh-56px)] lg:flex-none lg:grid-cols-[360px_1fr]" aria-busy="true" aria-label="Loading analysis">
      <div className="space-y-3 border-r border-line bg-white p-4">
        <div className="h-4 w-24 animate-pulse rounded bg-canvas" />
        <div className="h-12 w-full animate-pulse rounded bg-canvas" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-14 animate-pulse rounded bg-canvas" />
          ))}
        </div>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-11 animate-pulse rounded bg-canvas" />
        ))}
      </div>
      <div className="grid place-items-center bg-canvas text-small text-ink-muted">Preparing the analysis…</div>
    </div>
  );
}
