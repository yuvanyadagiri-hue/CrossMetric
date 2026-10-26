import type { MetadataRoute } from "next";

/**
 * Installable app (navy launch screen, the lime-and-blue X mark on a navy tile). Icons are rendered from the CrossMetric mark by
 * scripts/make-app-icons.mjs; shortcuts open a tab (`?view=`), read once by the app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CrossMetric",
    short_name: "CrossMetric",
    description: "Map. Plan. Move. Compare routes by time, cost, safety and accessibility around Georgia Tech, UGA and Georgia, and report sidewalk barriers for your community. No account.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    // The launch screen is navy, so the installed app's own splash is too (no flash of another colour first).
    background_color: "#07111F",
    theme_color: "#07111F",
    categories: ["travel", "navigation", "education"],
    lang: "en-US",
    dir: "ltr",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: [
      { name: "Nearby transit", short_name: "Nearby", description: "Stations and stops by walking time", url: "/?view=nearby", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Report a barrier", short_name: "Report", description: "Report a sidewalk or crossing barrier", url: "/report", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
