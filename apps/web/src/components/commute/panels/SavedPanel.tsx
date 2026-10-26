"use client";

import { useState } from "react";
import Link from "next/link";
import { Bookmark, Briefcase, ChevronRight, Clock3, GraduationCap, Home, MapPin, Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import { useRecentSearches, useSavedPlaces, type SavedPlace2 } from "@/lib/commute-store";
import { frequentRoutes } from "@/lib/journey-client";
import { when } from "../format";
import type { AppModel } from "../model";
import { IconButton, PanelHeader, SecondaryButton, SectionLabel, Segmented, StateMessage, TextButton } from "../ui";

const KINDS: [SavedPlace2["kind"], string][] = [
  ["home", "Home"],
  ["work", "Work"],
  ["school", "School"],
  ["other", "Other"],
];
const ICON: Record<SavedPlace2["kind"], typeof Home> = { home: Home, work: Briefcase, school: GraduationCap, other: Bookmark };

function PlaceRow({ app, p, editing, onEdit }: { app: AppModel; p: SavedPlace2; editing: boolean; onEdit: (v: boolean) => void }) {
  const [, setPlaces] = useSavedPlaces();
  const [name, setName] = useState(p.name);
  const Icon = ICON[p.kind];
  const update = (patch: Partial<SavedPlace2>) => setPlaces((list) => list.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
  if (editing) {
    return (
      <form
        className="-mx-2 my-1 space-y-3 rounded-surface border-2 border-app-select bg-[var(--app-selected-bg)] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          update({ name: name.trim().slice(0, 40) || p.place.label });
          onEdit(false);
        }}
      >
        <label className="block text-small font-medium" htmlFor={`name-${p.id}`}>
          Name
        </label>
        <input id={`name-${p.id}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="h-12 w-full rounded-ctl border border-app-line-strong bg-app-surface px-3 text-body" autoFocus />
        <Segmented label="Kind" value={p.kind} options={KINDS} onChange={(k) => update({ kind: k })} />
        <p className="truncate text-small text-app-muted">{[p.place.label, p.place.sublabel].filter(Boolean).join(" · ")}</p>
        <div className="flex gap-2">
          <button type="submit" className="min-h-[48px] flex-1 rounded-ctl bg-app-primary px-4 text-body font-semibold text-app-on-primary hover:bg-app-primary-hover">
            Save
          </button>
          <SecondaryButton
            icon={<Trash2 className="h-4 w-4" aria-hidden />}
            onClick={() => {
              setPlaces((list) => list.filter((x) => x.id !== p.id));
              app.toast(`Removed ${p.name}`);
            }}
          >
            Remove
          </SecondaryButton>
        </div>
      </form>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-5 w-5 shrink-0" aria-hidden />
      <button type="button" onClick={() => app.planTo(p.place)} className="min-h-[60px] min-w-0 flex-1 py-2 text-left">
        <span className="block text-body font-medium [overflow-wrap:anywhere]">{p.name}</span>
        <span className="block truncate text-small text-app-muted">{p.place.sublabel ?? p.place.label}</span>
      </button>
      <TextButton
        className="text-small"
        onClick={() => {
          app.journey.setOrigin({ ...p.place, source: "saved" });
          app.go({ kind: "plan" }, "half");
        }}
      >
        Start here
      </TextButton>
      <IconButton label={`Edit ${p.name}`} onClick={() => onEdit(true)} className="-mr-2">
        <Pencil className="h-4 w-4" aria-hidden />
      </IconButton>
    </div>
  );
}

/** The one start saved for class plans and reminders (it is a setting, so it sits with the places). */
function SavedStart({ app }: { app: AppModel }) {
  const origin = app.prefs.origin;
  if (!origin) return null;
  return (
    <div className="flex items-center gap-3 py-2">
      <Home className="h-5 w-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium [overflow-wrap:anywhere]">{origin.label}</span>
        <span className="block text-small text-app-muted">Saved start for class plans and reminders</span>
      </span>
      <TextButton className="text-small" onClick={() => app.setPrefs((x) => ({ ...x, origin: null }))}>
        Remove
      </TextButton>
    </div>
  );
}

/** Saved places, recent searches and frequent routes — all kept only in this browser. */
export function SavedPanel({ app, editId }: { app: AppModel; editId?: string | null }) {
  const [places] = useSavedPlaces();
  const [recents, setRecents] = useRecentSearches();
  const [editing, setEditing] = useState<string | null>(editId ?? null);
  const freq = frequentRoutes(recents);
  return (
    <div className="space-y-5 pt-1">
      <PanelHeader title="Saved" sub="Kept in this browser only. Nothing here is sent to CrossMetric." />

      <section className="space-y-2" aria-label="Saved places">
        <SectionLabel action={<TextButton onClick={() => app.openPicker("save")} icon={<Plus className="h-4 w-4" aria-hidden />} className="text-small">Add</TextButton>}>Places</SectionLabel>
        {places.length ? (
          <ul className="divide-y divide-app-line">
            {places.map((p) => (
              <li key={p.id}>
                <PlaceRow app={app} p={p} editing={editing === p.id} onEdit={(v) => setEditing(v ? p.id : null)} />
              </li>
            ))}
            {app.prefs.origin ? (
              <li>
                <SavedStart app={app} />
              </li>
            ) : null}
          </ul>
        ) : (
          <>
            <StateMessage icon={<MapPin className="h-5 w-5" />} title="No saved places yet" action={<SecondaryButton icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => app.openPicker("save")}>Add a place</SecondaryButton>}>
              Save home, work or school to plan trips in one tap.
            </StateMessage>
            <SavedStart app={app} />
          </>
        )}
      </section>

      {freq.length ? (
        <section className="space-y-1" aria-label="Frequent routes">
          <SectionLabel>Frequent</SectionLabel>
          <ul className="divide-y divide-app-line">
            {freq.slice(0, 3).map((f) => (
              <li key={f.id}>
                <button type="button" className="cm-press flex min-h-[52px] w-full items-center gap-3 py-2 text-left" onClick={() => {
                  const x = app.journey.restore(f.search, app.now);
                  if (x.needsLocation) void app.currentPlace().then((p) => p && app.journey.setOrigin(p));
                  app.go({ kind: "plan" }, "half");
                }}>
                  <Repeat className="h-5 w-5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 text-body [overflow-wrap:anywhere]">
                    {"current" in f.search.from ? "Your location" : f.search.from.label} → {f.search.to.label}
                  </span>
                  <span className="t-num text-small text-app-muted">{f.count}×</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-1" aria-label="Recent searches">
        <SectionLabel action={recents.length ? <TextButton className="text-small !text-app-red" onClick={() => setRecents([])}>Clear</TextButton> : undefined}>Recent searches</SectionLabel>
        {!app.prefs.keepHistory ? (
          <p className="text-small text-app-muted">Recent searches are off. Turn them on in Profile → Privacy.</p>
        ) : recents.length ? (
          <ul className="divide-y divide-app-line">
            {recents.map((r) => (
              <li key={r.id + r.at}>
                <button
                  type="button"
                  onClick={() => {
                    const x = app.journey.restore(r, app.now);
                    if (x.needsLocation) void app.currentPlace().then((p) => p && app.journey.setOrigin(p));
                    app.go({ kind: "plan" }, "half");
                  }}
                  className="cm-press flex min-h-[56px] w-full items-center gap-3 py-2 text-left"
                >
                  <Clock3 className="h-5 w-5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-body [overflow-wrap:anywhere]">
                      {"current" in r.from ? "Your location" : r.from.label} → {r.to.label}
                    </span>
                    <span className="block text-small text-app-muted">Searched {when(r.at, app.now)}</span>
                  </span>
                  <ChevronRight className="h-[18px] w-[18px] shrink-0 text-app-muted" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small text-app-muted">Searches you make appear here. A start from your current location is stored without its coordinates.</p>
        )}
      </section>

      <Link href="/saved" className="cm-press flex min-h-[52px] items-center justify-between border-t border-app-line text-body font-medium">
        Saved schools and safety trips
        <ChevronRight className="h-[18px] w-[18px] text-app-muted" aria-hidden />
      </Link>
    </div>
  );
}
