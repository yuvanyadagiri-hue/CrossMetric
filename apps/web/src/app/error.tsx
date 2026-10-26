"use client";

import { LogoMark } from "@/components/brand/Logo";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="flex min-h-dvh flex-col justify-center bg-[#07111F] px-6 py-16 text-[#F5F8FC]">
      <div className="mx-auto w-full max-w-[420px]" role="alert">
        <LogoMark size={48} />
        <h1 className="mt-8 t-page">CrossMetric couldn’t load.</h1>
        <p className="mt-3 text-body text-[#9BAABD]">Check your connection and try again. Nothing you saved on this device was lost.</p>
        <button type="button" onClick={reset} className="mt-8 inline-flex min-h-[52px] items-center rounded-ctl bg-[#91F24D] px-6 text-body font-semibold text-[#07111F] hover:bg-[#A6F56F]">
          Try again
        </button>
      </div>
    </main>
  );
}
