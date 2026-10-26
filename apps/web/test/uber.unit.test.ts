import { describe, expect, it } from "vitest";
import type { Place } from "@/lib/trip-types";
import { buildUberRideLink, cleanUberText, coordinateProblem, placeAddress, readUberClientId, stopFromPlace, UBER_UNIVERSAL_LINK } from "@/lib/uber";

// Format-valid stand-in for a real Uber client ID; tests never call Uber.
const CLIENT = "aBc123XyZ987-q_w";

function decode(url: string) {
  const u = new URL(url);
  return {
    base: `${u.origin}${u.pathname}`,
    keys: [...u.searchParams.keys()],
    clientId: u.searchParams.get("client_id"),
    pickup: JSON.parse(u.searchParams.get("pickup")!),
    drop: JSON.parse(u.searchParams.get("drop[0]")!),
  };
}

describe("Uber universal link", () => {
  it("reproduces Uber's documented example link exactly", () => {
    // https://developer.uber.com/docs/riders/ride-requests/tutorials/deep-links/introduction (product_id omitted: CrossMetric never sends it)
    const link = buildUberRideLink({
      clientId: CLIENT,
      area: null, // the example is in San Francisco
      pickup: { latitude: 37.77581, longitude: -122.418028, name: "UberHQ", address: "1455 Market St, San Francisco, CA 94103" },
      dropoff: { latitude: 37.802374, longitude: -122.405818, name: "Coit Tower", address: "1 Telegraph Hill Blvd, San Francisco, CA 94133" },
    });
    expect(link).toEqual({
      ok: true,
      url:
        `https://m.uber.com/looking?client_id=${CLIENT}` +
        "&pickup=%7B%22latitude%22%3A37.77581%2C%22longitude%22%3A-122.418028%2C%22addressLine1%22%3A%22UberHQ%22%2C%22addressLine2%22%3A%221455%20Market%20St%2C%20San%20Francisco%2C%20CA%2094103%22%7D" +
        "&drop[0]=%7B%22latitude%22%3A37.802374%2C%22longitude%22%3A-122.405818%2C%22addressLine1%22%3A%22Coit%20Tower%22%2C%22addressLine2%22%3A%221%20Telegraph%20Hill%20Blvd%2C%20San%20Francisco%2C%20CA%2094133%22%7D",
    });
  });

  it("maps CrossMetric's lon/lat places to Uber's latitude/longitude without swapping them", () => {
    const from: Place = { label: "Grady High School", sublabel: "High · Atlanta, GA", lon: -84.37395, lat: 33.78103, kind: "school", id: "130012000040" };
    const to: Place = { label: "1280 Peachtree St NE", sublabel: "Atlanta, GA", lon: -84.38412, lat: 33.79047, kind: "address" };
    const link = buildUberRideLink({ clientId: CLIENT, pickup: stopFromPlace(from), dropoff: stopFromPlace(to) });
    expect(link.ok).toBe(true);
    const d = decode((link as { url: string }).url);
    expect(d.base).toBe(UBER_UNIVERSAL_LINK);
    expect(d.keys).toEqual(["client_id", "pickup", "drop[0]"]);
    expect(d.clientId).toBe(CLIENT);
    expect(d.pickup).toEqual({ latitude: 33.78103, longitude: -84.37395, addressLine1: "Grady High School", addressLine2: "Atlanta, GA" });
    expect(d.drop).toEqual({ latitude: 33.79047, longitude: -84.38412, addressLine1: "1280 Peachtree St NE", addressLine2: "Atlanta, GA" });
  });

  it("encodes names with reserved characters safely and sends only documented parameters", () => {
    const link = buildUberRideLink({
      clientId: CLIENT,
      pickup: { latitude: 33.7, longitude: -84.4, name: 'Café "A&B" #2 + more' },
      dropoff: { latitude: 33.8, longitude: -84.3, name: "  Main   St\n entrance ", address: "100% Main St?x=1&y=2" },
    });
    const url = (link as { url: string }).url;
    expect(url).not.toMatch(/[ "#+]/);
    const d = decode(url);
    expect(d.keys).toEqual(["client_id", "pickup", "drop[0]"]);
    expect(d.pickup).toEqual({ latitude: 33.7, longitude: -84.4, addressLine1: 'Café "A&B" #2 + more' });
    expect(d.drop).toEqual({ latitude: 33.8, longitude: -84.3, addressLine1: "Main St entrance", addressLine2: "100% Main St?x=1&y=2" });
    expect(url).not.toMatch(/product_id|payment_method_id|action=|nickname|formatted_address/);
  });

  it("rounds coordinates to 6 decimals and omits empty labels", () => {
    const link = buildUberRideLink({ clientId: CLIENT, pickup: { latitude: 33.123456789, longitude: -84.987654321, name: "  " }, dropoff: { latitude: 33.2, longitude: -84.9 } });
    const d = decode((link as { url: string }).url);
    expect(d.pickup).toEqual({ latitude: 33.123457, longitude: -84.987654 });
    expect(d.drop).toEqual({ latitude: 33.2, longitude: -84.9 });
  });

  it("rejects missing, non-finite, out-of-range and swapped coordinates", () => {
    const ok = { latitude: 33.77, longitude: -84.39 };
    const bad = [
      { latitude: Number.NaN, longitude: -84.39 },
      { latitude: 33.77, longitude: Number.POSITIVE_INFINITY },
      { latitude: -84.39, longitude: 33.77 }, // lon/lat swapped: a valid point, but far outside Georgia
      { latitude: 34.05, longitude: -118.24 }, // Los Angeles
      { latitude: 33.77, longitude: -184.39 },
      { latitude: 0, longitude: 0 },
      { latitude: "33.77" as unknown as number, longitude: -84.39 },
    ];
    for (const pickup of bad) {
      const r = buildUberRideLink({ clientId: CLIENT, pickup, dropoff: { latitude: 33.8, longitude: -84.3 } });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.issues.map((i) => i.field)).toContain("pickup");
    }
    const missing = buildUberRideLink({ clientId: CLIENT, pickup: ok, dropoff: null });
    expect(!missing.ok && missing.issues.map((i) => i.field)).toEqual(["dropoff"]);
    expect(coordinateProblem(33.77, -84.39)).toBeNull();
    expect(coordinateProblem(90.0001, 0)).toMatch(/latitude/);
  });

  it("rejects a pickup and destination at the same place", () => {
    const r = buildUberRideLink({ clientId: CLIENT, pickup: { latitude: 33.77, longitude: -84.39 }, dropoff: { latitude: 33.77005, longitude: -84.39005 } });
    expect(!r.ok && r.issues).toEqual([expect.objectContaining({ field: "trip" })]);
  });

  it("never builds a link without a configured client ID", () => {
    const stops = { pickup: { latitude: 33.77, longitude: -84.39 }, dropoff: { latitude: 33.8, longitude: -84.3 } };
    for (const clientId of [null, "", "<CLIENT_ID>", "your-client-id", "short"]) {
      const r = buildUberRideLink({ ...stops, clientId });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.issues.map((i) => i.field)).toEqual(["config"]);
    }
    expect(readUberClientId(undefined)).toBeNull();
    expect(readUberClientId(`  ${CLIENT} `)).toBe(CLIENT);
  });
});

describe("Uber stop labels", () => {
  it("uses the verified address part of a place, never an approximate one", () => {
    expect(placeAddress({ label: "Georgia Tech", sublabel: "College · Atlanta, GA", lon: -84.39, lat: 33.77, kind: "college" })).toBe("Atlanta, GA");
    expect(placeAddress({ label: "Ponce City Market", sublabel: "675 Ponce De Leon Ave NE, Atlanta, GA", lon: -84.36, lat: 33.77, kind: "place" })).toBe("675 Ponce De Leon Ave NE, Atlanta, GA");
    expect(placeAddress({ label: "My location", sublabel: "Near 10th St NW", lon: -84.39, lat: 33.78, kind: "current" })).toBeUndefined();
    expect(placeAddress({ label: "Somewhere", sublabel: "Georgia", lon: -84.39, lat: 33.78, kind: "school" })).toBeUndefined();
    expect(placeAddress({ label: "From a shared link", lon: -84.39, lat: 33.78, kind: "place" })).toBeUndefined();
  });

  it("cleans and caps free text", () => {
    expect(cleanUberText("  a\u0007b \t c ")).toBe("a b c");
    expect(cleanUberText("x".repeat(500))).toHaveLength(120);
    expect(cleanUberText("   ")).toBeUndefined();
  });
});
