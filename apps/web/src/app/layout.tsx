import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import "./premium.css";
import Script from "next/script";
import { SPLASH_GATE_SCRIPT } from "@/components/brand/splash-gate";
import { PwaBoot } from "@/components/pwa/PwaBoot";

// One family for the whole product: Inter Variable (weights 100-900 in a single file, plus the
// optical-size axis, so headlines automatically switch to Inter's tighter display cut). It is
// self-hosted by next/font (no request to Google from the browser) and, like the other
// next/font loaders, ships a size-matched fallback so the swap does not shift layout.
// The type scale built on it lives in globals.css (--fs-* and the .t-* roles).
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], axes: ["opsz"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "CrossMetric", template: "%s · CrossMetric" },
  description: "CrossMetric brings route planning, accessibility insights, transit, parking and community barrier reports together for Georgia Tech, UGA and the communities around them. Map. Plan. Move.",
  applicationName: "CrossMetric",
  appleWebApp: { capable: true, title: "CrossMetric", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#07111F" },
    { media: "(prefers-color-scheme: dark)", color: "#07111F" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body>
        <Script id="cm-splash-gate" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: SPLASH_GATE_SCRIPT }} />
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:shadow">
          Skip to content
        </a>
        {children}
        <PwaBoot />
      </body>
    </html>
  );
}
