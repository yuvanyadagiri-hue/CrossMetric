import Link from "next/link";
import { LogoMark } from "@/components/brand/Logo";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col justify-center bg-[#07111F] px-6 py-16 text-[#F5F8FC]">
      <div className="mx-auto w-full max-w-[420px]">
        <LogoMark size={48} />
        <p className="mt-8 text-small font-medium text-[#9BAABD]">Error 404</p>
        <h1 className="mt-2 t-page">Wrong turn.</h1>
        <p className="mt-3 text-body text-[#9BAABD]">We couldn’t find that page. The map and your routes are one tap away.</p>
        <div className="mt-8 flex flex-wrap gap-2.5">
          <Link href="/" className="inline-flex min-h-[52px] items-center rounded-ctl bg-[#91F24D] px-6 text-body font-semibold text-[#07111F] hover:bg-[#A6F56F]">
            Open CrossMetric
          </Link>
          <Link href="/analyze" className="inline-flex min-h-[52px] items-center rounded-ctl border border-[#1B2A3E] px-6 text-body font-semibold text-[#F5F8FC] hover:bg-[#0D1929]">
            Road safety analysis
          </Link>
        </div>
      </div>
    </main>
  );
}
