import { Stage } from "@/components/commute/Stage";

/**
 * Everything in the app (the first-run pages and the rider app) lives in one stage with one launch
 * screen. The stage fills the window on every screen size. It stays
 * mounted while people move between its pages, so the launch screen is never cut short or replayed.
 */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <Stage>{children}</Stage>;
}
