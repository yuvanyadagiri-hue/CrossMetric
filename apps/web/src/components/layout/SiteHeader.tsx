"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Bookmark, ChevronDown, GitCompareArrows, LayoutDashboard, Menu, Search, X } from "lucide-react";
import { HeaderLogo } from "@/components/brand/Logo";
import { PlaceCombobox } from "@/components/search/PlaceCombobox";
import { tripHref } from "@/lib/place-url";
import type { Place } from "@/lib/trip-types";

/** The analysis workspace (crash-record research behind CrossScore); the rider app lives at "/". */
const NAV = [
  { href: "/analyze", label: "Priority for Review", match: (p: string) => p.startsWith("/analyze") || p.startsWith("/school/") },
  { href: "/schools", label: "Schools & Colleges", match: (p: string) => p.startsWith("/schools") },
  { href: "/map", label: "Statewide map", match: (p: string) => p.startsWith("/map") },
  { href: "/routes", label: "Route CrossScore", match: (p: string) => p.startsWith("/routes") },
  { href: "/reports", label: "Reports", match: (p: string) => p.startsWith("/reports") },
];

const SECONDARY = [
  { href: "/explore", label: "Dashboard", icon: LayoutDashboard, description: "The earlier overview of the analysis" },
  { href: "/saved", label: "Saved", icon: Bookmark, description: "Places and trips saved in this browser" },
  { href: "/schools/compare", label: "Compare", icon: GitCompareArrows, description: "Compare schools and colleges side by side" },
  { href: "/methodology", label: "Methodology", icon: BookOpen, description: "Data sources, scoring and limitations" },
];

function useGo() {
  const router = useRouter();
  return useCallback(
    (p: Place) => {
      if ((p.kind === "school" || p.kind === "college") && p.id) router.push(`/schools/${p.id}`);
      else router.push(tripHref("/routes", null, p, "walk"));
    },
    [router],
  );
}

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const go = useGo();
  const navRef = useRef<HTMLUListElement>(null);
  const [bar, setBar] = useState<{ x: number; w: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const activeIndex = NAV.findIndex((n) => n.match(pathname));

  const measure = useCallback(() => {
    const el = navRef.current?.querySelector<HTMLElement>(`[data-nav="${activeIndex}"]`);
    setBar(el ? { x: el.offsetLeft + 12, w: el.offsetWidth - 24 } : null);
  }, [activeIndex]);

  useLayoutEffect(() => {
    measure();
    const el = navRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  // Close menus on navigation.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMenuOpen(false);
    setMoreOpen(false);
    setSearchOpen(false);
  }

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMoreOpen(false);
        setMenuOpen(false);
        setSearchOpen(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const input = document.getElementById("global-search");
        if (input) input.focus();
        else setSearchOpen(true);
      }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-[#1B2A3E] bg-[#07111F] text-[#F5F8FC]">
      <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="group inline-flex shrink-0 items-center gap-2 rounded-md" aria-label="Back to the CrossMetric app">
          <ArrowLeft className="h-4 w-4 text-[#9BAABD] transition-transform group-hover:-translate-x-0.5" aria-hidden />
          <HeaderLogo className="text-[#F5F8FC]" />
        </Link>
        <span className="hidden rounded-tag border border-[#1B2A3E] px-2 py-0.5 text-meta font-medium text-[#9BAABD] xl:inline">Analysis</span>

        <nav aria-label="Primary" className="hidden min-w-0 flex-1 lg:block">
          <ul ref={navRef} className="relative flex items-center">
            {NAV.map((item, i) => {
              const active = i === activeIndex;
              return (
                <li key={item.href} data-nav={i}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex h-16 items-center whitespace-nowrap px-3 text-small font-medium transition-colors xl:px-3.5 ${active ? "text-[#F5F8FC]" : "text-[#9BAABD] hover:text-[#F5F8FC]"}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
            {bar ? (
              <span
                aria-hidden
                className="absolute bottom-0 left-0 h-[2.5px] rounded-full bg-uber transition-[transform,width] duration-300 ease-[var(--ease-out)]"
                style={{ width: bar.w, transform: `translateX(${bar.x}px)` }}
              />
            ) : null}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden w-[300px] md:block xl:w-[340px]">
            <PlaceCombobox id="global-search" label="Search schools, colleges, places or addresses" value={null} onSelect={go} placeholder="Search schools, places, or addresses…" variant="search" />
          </div>
          <button type="button" className="btn-quiet !text-[#9BAABD] hover:!bg-[#0D1929] hover:!text-[#F5F8FC] md:hidden" aria-label="Search" onClick={() => setSearchOpen((v) => !v)}>
            <Search className="h-5 w-5" aria-hidden />
          </button>
          <div ref={moreRef} className="relative hidden lg:block">
            <button type="button" className="btn-quiet !text-[#9BAABD] hover:!bg-[#0D1929] hover:!text-[#F5F8FC]" aria-expanded={moreOpen} aria-haspopup="menu" onClick={() => setMoreOpen((v) => !v)}>
              More
              <ChevronDown className={`h-4 w-4 transition-transform ${moreOpen ? "rotate-180" : ""}`} aria-hidden />
            </button>
            {moreOpen ? (
              <div role="menu" className="absolute right-0 top-full mt-2 w-[290px] rounded-ctl border border-line bg-white p-1.5 shadow-[var(--shadow-pop)] animate-[var(--animate-fade-in)]">
                {SECONDARY.map((s) => (
                  <Link key={s.href} role="menuitem" href={s.href} className="flex items-start gap-3 rounded-chip px-2.5 py-2 hover:bg-subtle">
                    <s.icon className="mt-0.5 h-4 w-4 text-ink-muted" aria-hidden />
                    <span>
                      <span className="block text-small font-medium text-navy-900">{s.label}</span>
                      <span className="block text-meta text-ink-muted">{s.description}</span>
                    </span>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" className="btn-quiet !text-[#9BAABD] hover:!bg-[#0D1929] hover:!text-[#F5F8FC] lg:hidden" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
            {menuOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>

      {searchOpen ? (
        <div className="border-t border-[#1B2A3E] bg-[#07111F] px-4 py-3 md:hidden">
          <PlaceCombobox label="Search schools, colleges, places or addresses" value={null} onSelect={go} placeholder="Search schools, places, or addresses…" variant="search" autoFocus />
        </div>
      ) : null}

      {menuOpen ? (
        <nav aria-label="Primary" className="border-t border-[#1B2A3E] bg-[#07111F] px-4 pb-4 pt-2 lg:hidden">
          <ul className="grid gap-0.5">
            {[...NAV, ...SECONDARY].map((item) => {
              const active = "match" in item ? item.match(pathname) : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-chip px-3 py-2.5 text-body font-medium ${active ? "bg-[#122136] text-[#F5F8FC]" : "text-[#9BAABD] hover:bg-[#0D1929] hover:text-[#F5F8FC]"}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
