"use client";

import { Compass, MapPinPlus, Route, UserRound, UsersRound } from "lucide-react";
import { LogoMark } from "@/components/brand/Logo";
import type { Tab } from "./model";

type MainTab = Exclude<Tab, "account">;

/** CrossMetric's four destinations. Report carries the accent: it is what makes the product different. */
const TABS: { id: MainTab; label: string; Icon: typeof Compass; accent?: boolean }[] = [
  { id: "explore", label: "Explore", Icon: Compass },
  { id: "routes", label: "Routes", Icon: Route },
  { id: "report", label: "Report", Icon: MapPinPlus, accent: true },
  { id: "community", label: "Community", Icon: UsersRound },
];

/**
 * Phone navigation: a solid bar along the bottom edge of the four main screens (the sheet sits on
 * top of it). Each item is a 64 px tall target with an icon and its name; the current one has a
 * lime icon tile.
 */
export function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <nav aria-label="Main" className="cm-tabbar absolute inset-x-0 bottom-0 z-30" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <ul className="mx-auto flex h-[var(--cm-tabbar-h)] max-w-[560px] items-stretch px-1">
        {TABS.map(({ id, label, Icon, accent }) => {
          const active = tab === id;
          return (
            <li key={id} className="flex min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onTab(id)}
                aria-current={active ? "page" : undefined}
                data-accent={accent || undefined}
                className="cm-tab group flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-ctl text-meta font-medium"
              >
                <span className="cm-tab-icon grid h-8 w-12 place-items-center rounded-full">
                  <Icon className="h-[21px] w-[21px] transition-transform duration-200 group-active:scale-90" strokeWidth={active ? 2.3 : 2} aria-hidden />
                </span>
                <span>{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Desktop navigation: a slim rail on the left edge with the mark, the four destinations and
 * Account at the foot. It stays the same on every screen, so the map never has to leave.
 */
export function NavRail({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const item = (id: Tab, label: string, Icon: typeof Compass, accent?: boolean) => (
    <button
      type="button"
      onClick={() => onTab(id)}
      aria-current={tab === id ? "page" : undefined}
      data-accent={accent || undefined}
      className="cm-rail-btn flex w-[64px] flex-col items-center gap-1 rounded-ctl py-2 text-meta font-medium"
    >
      <span className="cm-tab-icon grid h-9 w-12 place-items-center rounded-full">
        <Icon className="h-[21px] w-[21px]" strokeWidth={tab === id ? 2.3 : 2} aria-hidden />
      </span>
      <span>{label}</span>
    </button>
  );
  return (
    <nav aria-label="Main" className="cm-rail absolute inset-y-0 left-0 z-40 flex w-[var(--cm-rail-w)] flex-col items-center py-4">
      <button type="button" onClick={() => onTab("explore")} className="mb-5 grid h-12 w-12 place-items-center rounded-ctl hover:bg-[#0d1929]" aria-label="CrossMetric: back to Explore">
        <LogoMark size={34} nodeFill="#030810" />
      </button>
      <ul className="flex flex-col items-center gap-1.5">
        {TABS.map(({ id, label, Icon, accent }) => (
          <li key={id}>{item(id, label, Icon, accent)}</li>
        ))}
      </ul>
      <div className="mt-auto">{item("account", "Account", UserRound)}</div>
    </nav>
  );
}
