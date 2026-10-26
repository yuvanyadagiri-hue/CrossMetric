"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Building2, GraduationCap, LocateFixed, MapPin, School, Search, TrainFront } from "lucide-react";
import type { Place } from "@/lib/trip-types";

type Status = "idle" | "loading" | "done" | "error";

const KIND_ICON = {
  school: <School className="h-4 w-4" aria-hidden />,
  college: <GraduationCap className="h-4 w-4" aria-hidden />,
  address: <Building2 className="h-4 w-4" aria-hidden />,
  place: <MapPin className="h-4 w-4" aria-hidden />,
  current: <LocateFixed className="h-4 w-4" aria-hidden />,
  station: <TrainFront className="h-4 w-4" aria-hidden />,
};

export interface PlaceComboboxProps {
  label: string;
  /** Visible label above the field; omit for an sr-only label. */
  visibleLabel?: boolean;
  value: Place | null;
  onSelect: (place: Place) => void;
  placeholder?: string;
  /** Offer "Use my location" at the top of the list. */
  onUseLocation?: () => void;
  locating?: boolean;
  leadingIcon?: ReactNode;
  variant?: "field" | "search";
  autoFocus?: boolean;
  id?: string;
}

/**
 * Place picker (WAI-ARIA 1.2 combobox): Georgia schools, colleges, addresses
 * and places. Queries /api/places; Enter picks the highlighted option.
 */
export function PlaceCombobox({ label, visibleLabel = false, value, onSelect, placeholder, onUseLocation, locating, leadingIcon, variant = "field", autoFocus, id }: PlaceComboboxProps) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const listId = `${autoId}-list`;
  const [query, setQuery] = useState(value?.label ?? "");
  const [editing, setEditing] = useState(false);
  const [results, setResults] = useState<Place[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const shownText = editing ? query : (value?.label ?? query);
  const q = query.trim();
  const searching = editing && q.length >= 2;

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setStatus("loading");
      try {
        const res = await fetch(`/api/places?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { results: Place[] };
        setResults(body.results);
        setActive(0);
        setStatus("done");
      } catch (err) {
        if ((err as Error).name !== "AbortError") setStatus("error");
      }
    }, 180);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [q, searching]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditing(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  type Option = { kind: "location" } | { kind: "place"; place: Place };
  const options: Option[] = [...(onUseLocation ? [{ kind: "location" } as const] : []), ...(searching ? results.map((place) => ({ kind: "place", place }) as const) : [])];

  const choose = (o: Option | undefined) => {
    if (!o) return;
    setOpen(false);
    setEditing(false);
    if (o.kind === "location") onUseLocation?.();
    else {
      setQuery(o.place.label);
      onSelect(o.place);
    }
  };

  const isSearch = variant === "search";
  return (
    <div ref={boxRef} className="relative w-full">
      <label htmlFor={inputId} className={visibleLabel ? "mb-1.5 block text-small font-medium text-ink-muted" : "sr-only"}>
        {label}
      </label>
      <div
        className={`flex items-center gap-2 border bg-white transition-[border-color,box-shadow] focus-within:border-brand-500 focus-within:ring-[3px] focus-within:ring-brand-500/15 ${
          isSearch ? "h-10 rounded-full border-line-strong px-3.5" : "h-11 rounded-chip border-line-strong px-3"
        }`}
      >
        <span className="shrink-0 text-ink-muted">{leadingIcon ?? (isSearch ? <Search className="h-4 w-4" aria-hidden /> : value ? KIND_ICON[value.kind] : <MapPin className="h-4 w-4" aria-hidden />)}</span>
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={locating ? "Finding your location…" : shownText}
          readOnly={locating}
          onChange={(e) => {
            setEditing(true);
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={(e) => {
            if (!editing && value) {
              setQuery(value.label);
              setEditing(true);
              e.target.select();
            }
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(options.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              if (open && options.length) {
                e.preventDefault();
                choose(options[active]);
              }
            } else if (e.key === "Escape") {
              // Closing the suggestions shouldn't also close a surrounding dialog.
              if (open && (options.length > 0 || searching)) e.preventDefault();
              setOpen(false);
              setEditing(false);
            }
          }}
          className={`min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint ${isSearch ? "text-small" : "text-small font-medium"}`}
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {searching && status === "done" ? `${results.length} result${results.length === 1 ? "" : "s"}` : searching && status === "error" ? "Search failed" : ""}
      </p>
      {open && (options.length > 0 || searching) ? (
        <div className="absolute inset-x-0 top-full z-50 mt-1.5 overflow-hidden rounded-ctl border border-line bg-white shadow-[var(--shadow-pop)] animate-[var(--animate-fade-in)]">
          <ul id={listId} role="listbox" aria-label={`${label} suggestions`} className="max-h-[340px] overflow-y-auto py-1 scrollbar-thin">
            {options.map((o, i) => (
              <li
                key={o.kind === "location" ? "location" : `${o.place.kind}-${o.place.id ?? ""}-${o.place.lon}-${o.place.lat}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                className={`mx-1 flex cursor-pointer items-center gap-3 rounded-chip px-2.5 py-2 ${i === active ? "bg-brand-50" : ""}`}
              >
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-chip ${o.kind === "location" ? "bg-brand-50 text-brand-600" : "bg-subtle text-ink-soft"}`}>
                  {o.kind === "location" ? KIND_ICON.current : KIND_ICON[o.place.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-small font-medium text-navy-900">{o.kind === "location" ? "Use my location" : o.place.label}</span>
                  <span className="block truncate text-meta text-ink-muted">{o.kind === "location" ? "Your browser asks first; it is never stored" : o.place.sublabel}</span>
                </span>
              </li>
            ))}
          </ul>
          {searching && options.length === (onUseLocation ? 1 : 0) ? (
            <p className="border-t border-line px-3.5 py-3 text-small text-ink-muted">
              {status === "loading" ? "Searching…" : status === "error" ? "Search is unavailable right now. Try again." : "No Georgia place matches that search."}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
