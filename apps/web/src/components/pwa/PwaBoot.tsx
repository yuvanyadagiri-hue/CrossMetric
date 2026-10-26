"use client";

import { useEffect } from "react";
import { startInstallCapture } from "@/lib/pwa";

/**
 * Registers the offline shell (public/sw.js) in production builds and listens for the
 * browser's install prompt. In development it removes any worker left by a production
 * build on the same address, so a cached build can never hide code being edited.
 */
export function PwaBoot() {
  useEffect(() => {
    startInstallCapture();
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()));
      void caches?.keys().then((keys) => keys.filter((k) => k.startsWith("cm-sw-")).forEach((k) => void caches.delete(k)));
      return;
    }
    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        const ready = await navigator.serviceWorker.ready;
        // Files this page loaded before the worker existed, so the next offline start has them.
        const urls = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((u) => u.startsWith(window.location.origin) && /\/_next\/static\/|\/maplibre\//.test(u));
        ready.active?.postMessage({ type: "warm", urls: Array.from(new Set(urls)) });
      } catch {
        // No offline shell (private mode, or blocked by the browser); the app works the same online.
      }
    };
    if (document.readyState === "complete") void register();
    else window.addEventListener("load", () => void register(), { once: true });
  }, []);
  return null;
}
