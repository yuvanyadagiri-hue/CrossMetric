"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, LocateFixed, Loader2 } from "lucide-react";
import { markWelcomeSeen } from "@/components/commute/welcome-state";

/**
 * Before the browser asks for location, say why (Uber does the same): CrossMetric uses it once, to
 * start routes from where you are and to show the stops around you. It is never stored, and the app
 * works without it. Allowing is optional.
 */
export function LocationPrimer() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const finish = () => {
    markWelcomeSeen();
    router.replace("/");
  };
  const allow = () => {
    if (!("geolocation" in navigator)) return finish();
    setBusy(true);
    // The browser shows its own prompt. Whatever the answer, the app opens; it reads the permission itself.
    navigator.geolocation.getCurrentPosition(finish, finish, { timeout: 12_000, maximumAge: 60_000 });
  };

  return (
    <main id="main" className="cm-app absolute inset-0 flex flex-col bg-[#07111F] text-[#F5F8FC]" data-theme="dark">
      <header className="flex h-14 shrink-0 items-center px-3" style={{ marginTop: "env(safe-area-inset-top)" }}>
        <button type="button" onClick={() => router.back()} aria-label="Back" className="cm-press grid h-11 w-11 place-items-center rounded-full hover:bg-white/10">
          <ArrowLeft className="h-6 w-6" aria-hidden />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
        <div className="relative grid h-[220px] w-[220px] place-items-center" aria-hidden>
          <span className="cm-ring" />
          <span className="cm-ring" />
          <span className="cm-ring" />
          <span className="cm-float relative grid h-[92px] w-[92px] place-items-center rounded-full bg-uber text-on-uber">
            <LocateFixed className="h-11 w-11" strokeWidth={2.2} />
          </span>
        </div>
        <h1 className="t-display mt-4 text-center text-[#F5F8FC] !text-[clamp(34px,10.4vw,42px)]">Start from where you are.</h1>
        <p className="mt-3 max-w-[330px] text-center text-component leading-snug text-[#9BAABD]">CrossMetric uses your location to start routes from you and to show the stops around you.</p>

        <ul className="mt-6 w-full max-w-[340px] space-y-2.5">
          {["Only when you ask, never in the background", "Never stored, and never sent with a shared link", "Optional: you can always type an address"].map((t) => (
            <li key={t} className="flex items-start gap-3 text-body font-medium text-[#F5F8FC]/90">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-tag bg-uber text-on-uber" aria-hidden>
                <Check className="h-3.5 w-3.5" strokeWidth={3.4} />
              </span>
              {t}
            </li>
          ))}
        </ul>
      </div>

      <footer className="mx-auto w-full max-w-[520px] shrink-0 space-y-2 px-5 pt-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}>
        <button
          type="button"
          onClick={allow}
          disabled={busy}
          className="cm-press flex min-h-[58px] w-full items-center justify-center gap-2 rounded-ctl bg-uber px-5 text-body font-semibold text-on-uber"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : null}
          {busy ? "Waiting for your answer…" : "Allow location"}
        </button>
        <button type="button" onClick={finish} className="cm-press flex min-h-[52px] w-full items-center justify-center rounded-surface text-body font-semibold text-[#F5F8FC] hover:bg-white/10">
          Not now, I&rsquo;ll type an address
        </button>
      </footer>
    </main>
  );
}
