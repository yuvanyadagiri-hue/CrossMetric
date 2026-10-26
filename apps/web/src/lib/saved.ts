"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Saved institutions and trips — kept only in this browser (localStorage).
 * CrossMetric has no accounts, so nothing saved here ever leaves the device.
 */

export interface SavedInstitution {
  kind: "institution";
  id: string;
  name: string;
  type: "k12" | "college";
  city: string | null;
  savedAt: string;
}

export interface SavedTrip {
  kind: "trip";
  id: string;
  label: string;
  href: string;
  savedAt: string;
}

export type SavedItem = SavedInstitution | SavedTrip;

const KEY = "crossmetric:saved:v1";
const listeners = new Set<() => void>();
let cache: SavedItem[] | null = null;
const EMPTY: SavedItem[] = [];

function read(): SavedItem[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as SavedItem[]) : [];
    cache = Array.isArray(parsed) ? parsed.filter((x) => x && (x.kind === "institution" || x.kind === "trip")) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(items: SavedItem[]) {
  cache = items;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Private browsing or storage disabled: keep the in-memory list for this visit.
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSaved() {
  const items = useSyncExternalStore(subscribe, read, () => EMPTY);
  const isSaved = useCallback((kind: SavedItem["kind"], id: string) => items.some((x) => x.kind === kind && x.id === id), [items]);
  const toggle = useCallback((item: Omit<SavedInstitution, "savedAt"> | Omit<SavedTrip, "savedAt">) => {
    const current = read();
    const exists = current.some((x) => x.kind === item.kind && x.id === item.id);
    write(exists ? current.filter((x) => !(x.kind === item.kind && x.id === item.id)) : [{ ...item, savedAt: new Date().toISOString() } as SavedItem, ...current].slice(0, 100));
  }, []);
  const remove = useCallback((kind: SavedItem["kind"], id: string) => write(read().filter((x) => !(x.kind === kind && x.id === id))), []);
  return { items, isSaved, toggle, remove };
}
