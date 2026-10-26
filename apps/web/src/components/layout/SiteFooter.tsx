import Link from "next/link";
import { HeaderLogo } from "@/components/brand/Logo";

const LINKS = [
  { href: "/methodology", label: "Methodology" },
  { href: "/methodology#crossscore", label: "How CrossScore works" },
  { href: "/methodology#data", label: "Data sources" },
  { href: "/methodology#limitations", label: "Limitations" },
  { href: "/methodology#privacy", label: "Privacy" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
          <HeaderLogo />
          <p className="max-w-[520px] text-meta leading-relaxed text-ink-muted">
            Map. Plan. Move. CrossMetric analyzes public historical data; it does not predict crashes or guarantee anyone&rsquo;s safety. Community reports are not official data.
          </p>
        </div>
        <div className="flex flex-col gap-2 lg:items-end">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-ink-soft hover:text-navy-900">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-meta text-ink-muted">
            No accounts · No tracking · Map and routing data © OpenStreetMap contributors · Crash and road data: Georgia DOT
          </p>
        </div>
      </div>
    </footer>
  );
}
