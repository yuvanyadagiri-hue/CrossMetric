import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[560px] px-6 py-24 text-center">
      <p className="eyebrow">Not found</p>
      <h1 className="mt-2 text-section font-semibold text-navy-900">We couldn’t find that school or page.</h1>
      <p className="mt-2 text-small text-ink-soft">CrossMetric covers Georgia public schools listed by NCES for 2024–25 (full-time virtual schools are excluded).</p>
      <Link href="/analyze" className="btn-primary mt-6">
        Search for a school
      </Link>
    </div>
  );
}
