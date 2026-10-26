"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { SchoolSummary } from "@/lib/published";

type Result = SchoolSummary & { matched: "name" | "city" | "district" };

/**
 * School search combobox (WAI-ARIA 1.2 combobox pattern).
 * Queries /api/schools/search; Enter opens the highlighted school.
 */
export function SchoolSearch({ autoFocus = false, size = "lg", hrefFor = (id) => `/analyze/${id}`, placeholder = "Search for a Georgia school…" }: { autoFocus?: boolean; size?: "lg" | "md"; hrefFor?: (id: string) => string; placeholder?: string }) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const q = query.trim();
  const searching = q.length >= 2;
  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setStatus("loading");
      try {
        const res = await fetch(`/api/schools/search?q=${encodeURIComponent(q)}&limit=8`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { results: Result[] };
        setResults(body.results);
        setActive(0);
        setOpen(true);
        setStatus("done");
      } catch (err) {
        if ((err as Error).name !== "AbortError") setStatus("error");
      }
    }, 140);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [q, searching]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const shown = searching ? results : [];
  const shownStatus = searching ? status : "idle";

  const go = (r: Result | undefined) => {
    if (!r) return;
    setOpen(false);
    router.push(hrefFor(r.id));
  };

  const big = size === "lg";
  return (
    <div ref={boxRef} className="relative w-full">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go(shown[active]);
        }}
        className={`flex items-stretch overflow-hidden rounded-chip border border-line-strong bg-white shadow-[var(--shadow-panel)] focus-within:border-blue-500 focus-within:ring-[3px] focus-within:ring-blue-500/15`}
      >
        <label htmlFor={`${listId}-input`} className="sr-only">
          Search for a Georgia public school or college by name, city or district
        </label>
        <span className="grid place-items-center pl-3.5 text-ink-muted" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
        </span>
        <input
          ref={inputRef}
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={open && shown.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${listId}-opt-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => shown.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(shown.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className={`w-0 min-w-0 flex-1 bg-transparent px-3 text-ink outline-none placeholder:text-ink-faint ${big ? "py-3.5 text-body" : "py-2.5 text-small"}`}
        />
        <button type="submit" className={`btn-primary rounded-none ${big ? "px-6 text-small" : "px-4"}`} disabled={!shown.length}>
          Search
        </button>
      </form>
      <p className="sr-only" aria-live="polite">
        {shownStatus === "done" ? `${shown.length} school${shown.length === 1 ? "" : "s"} found` : shownStatus === "error" ? "Search failed" : ""}
      </p>
      {open && searching ? (
        <div className="absolute inset-x-0 top-full z-40 mt-1.5 overflow-hidden rounded-chip border border-line bg-white shadow-[var(--shadow-float)]">
          {shown.length ? (
            <ul id={listId} role="listbox" aria-label="Matching schools">
              {shown.map((r, i) => (
                <li
                  key={r.id}
                  id={`${listId}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(r);
                  }}
                  className={`flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 ${i === active ? "bg-blue-50" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-small font-medium text-navy-900">{r.name}</span>
                    <span className="block truncate text-meta text-ink-muted">
                      {[r.city, r.district].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-meta text-ink-faint">{r.level ?? "School"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3.5 py-3 text-small text-ink-soft">
              {shownStatus === "loading" ? "Searching…" : shownStatus === "error" ? "Search is unavailable right now." : "No Georgia public school matches that search."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
