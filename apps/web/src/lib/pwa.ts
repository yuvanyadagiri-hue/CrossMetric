import { useSyncExternalStore } from "react";

/**
 * Install state for the app (a tiny external store). Chrome, Edge and Android offer an
 * install prompt event; Safari on iPhone and iPad installs from the Share menu, so it gets
 * instructions instead. Nothing here is sent anywhere.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface InstallState {
  /** Running as an installed app. */
  installed: boolean;
  /** The browser offered an install prompt we can show. */
  canPrompt: boolean;
  /** iPhone or iPad Safari: install via Share → Add to Home Screen. */
  ios: boolean;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installedNow = false;
let state: InstallState = { installed: false, canPrompt: false, ios: false };
const listeners = new Set<() => void>();
let started = false;

function compute(): InstallState {
  if (typeof window === "undefined") return state;
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return { installed: standalone || installedNow, canPrompt: !!deferred && !standalone && !installedNow, ios: ios && !standalone };
}

function emit() {
  const next = compute();
  if (next.installed !== state.installed || next.canPrompt !== state.canPrompt || next.ios !== state.ios) state = next;
  listeners.forEach((l) => l());
}

/** Starts listening for the browser's install events (once, as early as possible). */
export function startInstallCapture() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    // Keep the event so the app's own "Install" button can show the browser's prompt.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installedNow = true;
    emit();
  });
  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", emit);
  emit();
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const e = deferred;
  if (!e) return "unavailable";
  deferred = null;
  await e.prompt();
  const choice = await e.userChoice.catch(() => ({ outcome: "dismissed" as const }));
  emit();
  return choice.outcome;
}

export function useInstall(): InstallState {
  return useSyncExternalStore(
    (l) => {
      startInstallCapture();
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}
