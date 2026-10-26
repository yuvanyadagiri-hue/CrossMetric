import { describe, expect, it } from "vitest";
import { allowSubmission, availabilityLabel, isSuspiciousBurst, summarizeAvailability, type Observation } from "../src/commute/observations";

const NOW = Date.UTC(2026, 9, 13, 14, 0, 0);
const min = (m: number) => NOW - m * 60_000;
let n = 0;
const ob = (kind: Observation["kind"], reporter: string, ageMin: number, placeId = "gt-W02"): Observation => ({ id: String(n++), placeId, kind, reporter, at: min(ageMin) });

describe("parking observations", () => {
  it("one report stays visibly one report and expires after 3 minutes", () => {
    const one = [ob("opening", "a", 2)];
    const s = summarizeAvailability(one, "gt-W02", NOW);
    expect(s).toMatchObject({ state: "opening", reports: 1 });
    expect(availabilityLabel(s, NOW)).toBe("Opening reported · 2m ago");
    expect(summarizeAvailability([ob("opening", "a", 4)], "gt-W02", NOW).state).toBe("none");
  });

  it("full reports live for 10 minutes and expired ones never stay live", () => {
    expect(summarizeAvailability([ob("full", "a", 9)], "gt-W02", NOW).state).toBe("full");
    const old = summarizeAvailability([ob("full", "a", 11)], "gt-W02", NOW);
    expect(old.state).toBe("none");
    expect(availabilityLabel(old, NOW)).toBe("No recent reports");
  });

  it("shows conflicting reports when no category reaches 70% of the weight", () => {
    const s = summarizeAvailability([ob("opening", "a", 0.5), ob("full", "b", 0.5)], "gt-W02", NOW);
    expect(s.state).toBe("conflicting");
    expect(availabilityLabel(s, NOW)).toBe("Conflicting reports");
  });

  it("a fresh opening outweighs an older full report as it decays", () => {
    const s = summarizeAvailability([ob("opening", "a", 0), ob("full", "b", 9)], "gt-W02", NOW);
    expect(s.state).toBe("opening");
  });

  it("keeps only the latest report per reporter (no self-multiplication)", () => {
    const s = summarizeAvailability([ob("full", "a", 1), ob("full", "a", 2), ob("full", "a", 3)], "gt-W02", NOW);
    expect(s.reports).toBe(1);
    const changed = summarizeAvailability([ob("full", "a", 5), ob("opening", "a", 0.2)], "gt-W02", NOW);
    expect(changed.state).toBe("opening");
  });

  it("ignores meter reports, held reports and other places", () => {
    expect(summarizeAvailability([ob("meter_active", "a", 1), ob("full", "b", 1, "gt-W23"), { ...ob("full", "c", 1), verification: "held" }], "gt-W02", NOW).state).toBe("none");
  });

  it("rate-limits repeated and rapid submissions", () => {
    const recent = [ob("full", "a", 0.5)];
    expect(allowSubmission(recent, "a", "gt-W02", NOW)).toEqual({ ok: false, reason: "You just reported this place." });
    expect(allowSubmission(recent, "a", "gt-W23", NOW).ok).toBe(true);
    const many = Array.from({ length: 6 }, (_, i) => ob("full", "a", i + 1, `p${i}`));
    expect(allowSubmission(many, "a", "gt-W02", NOW).ok).toBe(false);
  });

  it("flags bursts from many reporters at one place", () => {
    const burst = Array.from({ length: 8 }, (_, i) => ob("opening", `r${i}`, 0.5));
    expect(isSuspiciousBurst(burst, "gt-W02", NOW)).toBe(true);
    expect(isSuspiciousBurst(burst.slice(0, 3), "gt-W02", NOW)).toBe(false);
  });
});
