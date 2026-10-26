import type { School } from "@crossmetric/engine";

function gradeSpan(school: School): string | null {
  const fmt = (g: string | null) => (g === null ? null : g === "PK" ? "Pre-K" : g === "KG" ? "K" : String(Number(g)));
  const lo = fmt(school.gradeLow);
  const hi = fmt(school.gradeHigh);
  return lo && hi ? `Grades ${lo}–${hi}` : null;
}

export function SchoolCard({ school }: { school: School }) {
  const place = [school.city, "GA"].filter(Boolean).join(", ");
  const level = school.level && school.level !== "Other" ? `Public ${school.level.toLowerCase()} school` : "Public school";
  const grades = gradeSpan(school);
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-50 ring-1 ring-inset ring-blue-100" aria-hidden>
        <svg width="24" height="24" viewBox="0 0 100 100">
          <g fill="#1b365f">
            <path d="M 10 40 L 36 34 L 36 82 L 10 82 Z" />
            <path d="M 64 34 L 90 40 L 90 82 L 64 82 Z" />
            <path d="M 33 32 L 50 16 L 67 32 L 67 82 L 33 82 Z" />
            <rect x="48.5" y="2" width="3" height="16" />
            <path d="M 51.5 2 L 63 6 L 51.5 10 Z" />
          </g>
          <g fill="#eef4fd">
            <rect x="15" y="46" width="7" height="7" />
            <rect x="24" y="46" width="7" height="7" />
            <rect x="69" y="46" width="7" height="7" />
            <rect x="78" y="46" width="7" height="7" />
            <path d="M 44 82 L 44 66 A 6 6 0 0 1 56 66 L 56 82 Z" />
          </g>
        </svg>
      </span>
      <div className="min-w-0">
        <h1 className="text-body font-semibold leading-tight text-navy-900">{school.name}</h1>
        <p className="mt-0.5 text-meta text-ink-soft">{place}</p>
        <p className="text-meta text-ink-muted">
          {level}
          {grades ? ` · ${grades}` : ""}
        </p>
        {school.district ? <p className="truncate text-meta text-ink-muted">{school.district}</p> : null}
      </div>
    </div>
  );
}
