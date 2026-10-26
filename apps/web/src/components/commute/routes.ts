import type { PickTarget, View } from "./model";

/**
 * The app's screens are real pages. This is the one place that maps a screen (a `View`) to its
 * address and back, so links, the browser's Back button, reloads and shared links all agree.
 *
 *   /                 Home                      /trip            Choose a trip (map + options)
 *   /services         Services                  /trip/details    One option in full
 *   /activity         Activity                  /trip/live       Trip in progress
 *   /activity/:id     A past trip               /trip/arrived    You've arrived
 *   /account          Account                   /nearby          Transit near you
 *   /account/places   Saved places              /parking         Campus parking
 *   /account/settings Preferences               /night           Night travel
 *   /account/classes  Classes                   /car, /car/return  Your parked car
 *   /safety, /help    Safety toolkit, Help      /stop            One stop's times
 *   /search           Where to? (page)          /welcome         First-run screens (outside the shell)
 *   /arrive           ArriveBy: when to leave, where to park, a backup (map + plan)
 *   /report           Report a sidewalk or crossing barrier (map + steps)
 *   /community        Community barrier reports (map + list); ?report=<id> opens one
 *
 * The four tabs are Explore (/), Routes (/trip), Report (/report) and Community (/community).
 */

const SEARCH_TARGETS: readonly PickTarget[] = ["destination", "origin", "nearby", "save", "start", "arrive", "report"];

const q = (params: Record<string, string | number | null | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export function viewHref(v: View): string {
  switch (v.kind) {
    case "home":
      return "/";
    case "services":
      return "/services";
    case "activity":
      return "/activity";
    case "receipt":
      return `/activity/${encodeURIComponent(v.id)}`;
    case "safety":
      return "/safety";
    case "help":
      return "/help";
    case "search":
      return `/search${q({ for: v.target })}`;
    case "plan":
      return "/trip";
    case "arrive":
      return "/arrive";
    case "detail":
      return "/trip/details";
    case "trip":
      return "/trip/live";
    case "arrived":
      return "/trip/arrived";
    case "nearby":
      return `/nearby${q({ station: v.stationId })}`;
    case "saved":
      return `/account/places${q({ edit: v.editId })}`;
    case "profile":
      return "/account";
    case "prefs":
      return "/account/settings";
    case "schedule":
      return "/account/classes";
    case "parking":
      return `/parking${q({ place: v.placeId })}`;
    case "night":
      return "/night";
    case "parked":
      return "/car";
    case "return":
      return "/car/return";
    case "stop":
      return `/stop${q({ id: v.stop.id, name: v.stop.name, lon: v.stop.lon, lat: v.stop.lat })}`;
    case "report":
      return "/report";
    case "community":
      return `/community${q({ report: v.reportId })}`;
  }
}

const num = (s: string | null): number | null => {
  if (s === null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** The screen at an address, or null for an address that is not a screen of the app. */
export function viewFromLocation(pathname: string, params: URLSearchParams): View | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  switch (path) {
    case "/":
      return { kind: "home" };
    case "/services":
      return { kind: "services" };
    case "/activity":
      return { kind: "activity" };
    case "/safety":
      return { kind: "safety" };
    case "/help":
      return { kind: "help" };
    case "/search": {
      const t = params.get("for") as PickTarget | null;
      return { kind: "search", target: t && SEARCH_TARGETS.includes(t) ? t : "destination" };
    }
    case "/trip":
      return { kind: "plan" };
    case "/arrive":
      return { kind: "arrive" };
    case "/trip/details":
      return { kind: "detail" };
    case "/trip/live":
      return { kind: "trip" };
    case "/trip/arrived":
      return { kind: "arrived" };
    case "/nearby":
      return { kind: "nearby", stationId: params.get("station") };
    case "/account":
      return { kind: "profile" };
    case "/account/places":
      return { kind: "saved", editId: params.get("edit") };
    case "/account/settings":
      return { kind: "prefs" };
    case "/account/classes":
      return { kind: "schedule" };
    case "/parking":
      return { kind: "parking", placeId: params.get("place") };
    case "/night":
      return { kind: "night" };
    case "/car":
      return { kind: "parked" };
    case "/car/return":
      return { kind: "return" };
    case "/report":
      return { kind: "report" };
    case "/community": {
      const id = params.get("report");
      return { kind: "community", reportId: id && /^[0-9a-f-]{36}$/i.test(id) ? id : null };
    }
    case "/stop": {
      const id = params.get("id");
      const name = params.get("name");
      const lon = num(params.get("lon"));
      const lat = num(params.get("lat"));
      // A stop needs all four; a link without them is not a screen (the page falls back to Services).
      return id && name && lon !== null && lat !== null ? { kind: "stop", stop: { id, name, lon, lat } } : { kind: "services" };
    }
  }
  const receipt = /^\/activity\/([^/]+)$/.exec(path);
  if (receipt) return { kind: "receipt", id: decodeURIComponent(receipt[1]!) };
  return null;
}

/** Where "Back" goes when the page was opened directly and there is nothing to go back to. */
export function parentView(v: View): View {
  switch (v.kind) {
    case "receipt":
      return { kind: "activity" };
    case "saved":
    case "prefs":
    case "schedule":
    case "help":
    case "activity":
      return { kind: "profile" };
    case "nearby":
    case "parking":
    case "night":
    case "parked":
    case "return":
    case "stop":
    case "safety":
      return { kind: "services" };
    case "detail":
      return { kind: "plan" };
    default:
      return { kind: "home" };
  }
}

/** The four tab roots: the only screens that show the phone's tab bar. */
export const TAB_ROOTS: ReadonlySet<View["kind"]> = new Set<View["kind"]>(["home", "plan", "report", "community"]);

/**
 * Screens that are pages on a phone (no map): Account and its subpages, all services, trip history,
 * search and arrival. Everything else is the map with a sheet. On a desktop every screen sits in the
 * side panel beside the map.
 */
export const PAGE_KINDS: ReadonlySet<View["kind"]> = new Set<View["kind"]>(["services", "activity", "receipt", "profile", "saved", "prefs", "schedule", "safety", "help", "search", "arrived"]);
