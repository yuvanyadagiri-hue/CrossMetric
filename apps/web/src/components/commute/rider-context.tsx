"use client";

import { createContext, useContext } from "react";
import type { AppModel } from "./model";

const RiderContext = createContext<AppModel | null>(null);

export const RiderProvider = RiderContext.Provider;

/**
 * The app's state (journey, trip, places, settings, map) lives in the shell layout, so it
 * survives moving between pages; every page reads it here.
 */
export function useRider(): AppModel {
  const app = useContext(RiderContext);
  if (!app) throw new Error("useRider must be used inside the CrossMetric app shell");
  return app;
}
