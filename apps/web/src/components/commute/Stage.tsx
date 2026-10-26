import { Splash } from "@/components/brand/Splash";

/**
 * The app fills the window on every screen: a phone gets the map with a sheet and a tab bar, a
 * desktop gets a rail, a side panel and a wide map (the layout is chosen inside RiderShell). The
 * launch screen plays over it once per cold start.
 */
export function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div className="cm-stage">
      <div className="cm-device">
        {children}
        <Splash />
      </div>
    </div>
  );
}
