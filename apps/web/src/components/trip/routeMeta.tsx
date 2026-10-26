import { Scale, ShieldCheck, Zap } from "lucide-react";
import type { RouteRole } from "@crossmetric/engine";

export const ROLE_META: Record<RouteRole, { label: string; blurb: string; Icon: typeof ShieldCheck }> = {
  safest: { label: "Safest route", blurb: "Optimized toward lower-risk conditions", Icon: ShieldCheck },
  balanced: { label: "Balanced route", blurb: "Balances conditions and travel time", Icon: Scale },
  fastest: { label: "Fastest route", blurb: "Shortest travel time, with tradeoffs shown", Icon: Zap },
};

export function rolesLabel(roles: RouteRole[]): string {
  if (roles.length === 3) return "Safest, balanced and fastest";
  return roles.map((r, i) => (i === 0 ? ROLE_META[r].label.replace(" route", "") : ROLE_META[r].label.replace(" route", "").toLowerCase())).join(" & ") + " route";
}
