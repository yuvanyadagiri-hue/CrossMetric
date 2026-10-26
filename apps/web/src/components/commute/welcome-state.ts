/**
 * First launch: the welcome pages come first, once. Kept in this browser's storage only.
 * Automation (navigator.webdriver) skips them, like the intro animation; `?welcome=1` forces them.
 */
const KEY = "cm.welcome.v1";

export function hasSeenWelcome(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("welcome") === "1") return false;
    if (navigator.webdriver) return true;
    return window.localStorage.getItem(KEY) === "done";
  } catch {
    // Storage blocked: do not send people through the welcome pages on every visit.
    return true;
  }
}

export function markWelcomeSeen(): void {
  try {
    window.localStorage.setItem(KEY, "done");
  } catch {
    // Storage blocked: harmless.
  }
}
