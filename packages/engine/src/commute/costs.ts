/**
 * Commute costs. Marginal cash cost of today's trip is kept separate from
 * allocated ownership/permit cost. Missing inputs stay unknown, never zero.
 */

export interface TripCostInputs {
  /** One-way driven miles; doubled for a round trip. */
  drivenMiles: number;
  mpg: number | null;
  fuelPricePerGallon: number | null;
  /** Incremental parking for the stay (USD), null when unknown. */
  parkingUsd: number | null;
  /** Fares for both directions (USD), null when unknown. */
  transitFaresUsd: number | null;
  tollsUsd?: number;
  roundTrip?: boolean;
}

export interface TripCost {
  total: number | null;
  fuel: number | null;
  parking: number | null;
  transit: number | null;
  tolls: number;
  missing: ("fuel price" | "mpg" | "parking price" | "fare")[];
}

const cents = (v: number) => Math.round(v * 100) / 100;

export function marginalTripCost(i: TripCostInputs): TripCost {
  const missing: TripCost["missing"] = [];
  const miles = i.drivenMiles * (i.roundTrip === false ? 1 : 2);
  let fuel: number | null = 0;
  if (miles > 0) {
    if (i.fuelPricePerGallon === null) missing.push("fuel price");
    if (i.mpg === null || !(i.mpg > 0)) missing.push("mpg");
    fuel = i.fuelPricePerGallon !== null && i.mpg && i.mpg > 0 ? cents((miles / i.mpg) * i.fuelPricePerGallon) : null;
  }
  if (i.parkingUsd === null) missing.push("parking price");
  if (i.transitFaresUsd === null) missing.push("fare");
  const tolls = i.tollsUsd ?? 0;
  const total = fuel === null || i.parkingUsd === null || i.transitFaresUsd === null ? null : cents(fuel + i.parkingUsd + i.transitFaresUsd + tolls);
  return { total, fuel, parking: i.parkingUsd, transit: i.transitFaresUsd, tolls, missing };
}

/** Permit cost spread over the commuting days it covers (an ownership view, not today's cash cost). */
export function allocatedPermitCost(permitCost: number, commutingDaysInPeriod: number): number | null {
  if (!(commutingDaysInPeriod > 0)) return null;
  return cents(permitCost / commutingDaysInPeriod);
}

export function formatUsd(v: number | null): string {
  if (v === null) return "Cost unknown";
  if (v === 0) return "$0";
  return v < 10 && v % 1 !== 0 ? `$${v.toFixed(2)}` : `$${Math.round(v * 100) % 100 === 0 ? v.toFixed(0) : v.toFixed(2)}`;
}
