import { Bike, Bus, Car, CarTaxiFront, Footprints, GraduationCap, School } from "lucide-react";
import type { ModeSummary, PlannerMode } from "@/lib/trip-types";

type AnyMode = ModeSummary["mode"];

export const MODE_LABEL: Record<AnyMode, string> = {
  walk: "Walk",
  bike: "Bike",
  transit: "Transit",
  drive: "Drive",
  rideshare: "Rideshare",
  schoolBus: "School bus",
  shuttle: "Campus shuttle",
};

export function ModeIcon({ mode, className = "h-4 w-4" }: { mode: AnyMode; className?: string }) {
  const props = { className, "aria-hidden": true } as const;
  switch (mode) {
    case "walk":
      return <Footprints {...props} />;
    case "bike":
      return <Bike {...props} />;
    case "transit":
      return <Bus {...props} />;
    case "drive":
      return <Car {...props} />;
    case "rideshare":
      return <CarTaxiFront {...props} />;
    case "schoolBus":
      return <School {...props} />;
    case "shuttle":
      return <GraduationCap {...props} />;
  }
}

export const PLANNER_MODE_ORDER: PlannerMode[] = ["walk", "bike", "transit", "drive", "rideshare"];
