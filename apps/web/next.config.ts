import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A second local server (e.g. a preview next to a running `npm run dev`) can use its own build folder.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // The scoring engine is shipped as TypeScript source from the monorepo.
  transpilePackages: ["@crossmetric/engine"],
  reactStrictMode: true,
  poweredByHeader: false,
  // The dev badge sits over the app's bottom tab bar; errors are still reported.
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Geolocation is allowed for this site only, for "Use my location" in the trip planner.
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=()" },
        ],
      },
      {
        // The service worker must never be served from a cache, so an update is picked up on the next visit.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
