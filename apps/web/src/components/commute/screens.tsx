"use client";

import { Compass } from "lucide-react";
import { useEffect } from "react";
import { ArrivePanel } from "./panels/ArrivePanel";
import { ArrivedPanel } from "./panels/ArrivedPanel";
import { DetailPanel } from "./panels/DetailPanel";
import { HelpPanel } from "./panels/HelpPanel";
import { CommunityPanel } from "./panels/CommunityPanel";
import { ExplorePanel } from "./panels/ExplorePanel";
import { NearbyPanel } from "./panels/NearbyPanel";
import { NightPanel } from "./panels/NightPanel";
import { ParkedPanel, ReturnPanel } from "./panels/ParkedPanel";
import { CampusPrompt, ParkingPanel } from "./panels/ParkingPanel";
import { PlanPanel } from "./panels/PlanPanel";
import { ReportPanel } from "./panels/ReportPanel";
import { PrefsPanel, ProfilePanel } from "./panels/ProfilePanel";
import { ReceiptPanel } from "./panels/ReceiptPanel";
import { SafetyPanel } from "./panels/SafetyPanel";
import { SavedPanel } from "./panels/SavedPanel";
import { SchedulePanel } from "./panels/SchedulePanel";
import { ActivityPanel } from "./panels/ActivityPanel";
import { ServicesPanel } from "./panels/services";
import { StopPanel } from "./panels/StopPanel";
import { TripPanel } from "./panels/TripPanel";
import { PlacePicker } from "./PlacePicker";
import { useRider } from "./rider-context";
import { PrimaryButton, StateMessage, TabPage } from "./ui";

/**
 * One small component per page: it reads the app's state from the shell and shows the screen.
 * (The route files in app/(rider) are server components that name each page.)
 */

/** Pages with ordinary content get the standard side padding and room under the status bar. */
function Padded({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4" style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}>
      {children}
    </div>
  );
}

export function HomeScreen() {
  return <ExplorePanel app={useRider()} />;
}

export function ReportScreen() {
  return <ReportPanel app={useRider()} />;
}

export function CommunityScreen() {
  return <CommunityPanel app={useRider()} />;
}

export function ServicesScreen() {
  const app = useRider();
  return (
    <TabPage title="All services" sub="Every way to get there, and help on campus." onBack={app.back}>
      <ServicesPanel app={app} />
    </TabPage>
  );
}

export function ActivityScreen() {
  const app = useRider();
  return (
    <TabPage title="Your trips" sub="Trips you took with CrossMetric, kept on this device only." onBack={app.back}>
      <ActivityPanel app={app} />
    </TabPage>
  );
}

export function ReceiptScreen({ id }: { id: string }) {
  return (
    <Padded>
      <ReceiptPanel app={useRider()} id={id} />
    </Padded>
  );
}

export function AccountScreen() {
  const app = useRider();
  return (
    <TabPage title="Account" sub="No sign-up. Your places, trips and settings stay on this device." onBack={app.layout === "desktop" ? undefined : app.back}>
      <ProfilePanel app={app} />
    </TabPage>
  );
}

export function PlacesScreen() {
  const app = useRider();
  return (
    <Padded>
      <SavedPanel app={app} editId={app.view.kind === "saved" ? app.view.editId : null} />
    </Padded>
  );
}

export function SettingsScreen() {
  return (
    <Padded>
      <PrefsPanel app={useRider()} />
    </Padded>
  );
}

export function ClassesScreen() {
  const app = useRider();
  return <Padded>{app.campus ? <SchedulePanel app={app} /> : <CampusPrompt app={app} what="Classes" />}</Padded>;
}

export function SafetyScreen() {
  return (
    <Padded>
      <SafetyPanel app={useRider()} />
    </Padded>
  );
}

export function HelpScreen() {
  return (
    <Padded>
      <HelpPanel app={useRider()} />
    </Padded>
  );
}

export function SearchScreen() {
  const app = useRider();
  if (app.view.kind !== "search") return null;
  const target = app.view.target;
  return <PlacePicker app={app} target={target} onClose={app.closeSearch} onPick={(r) => app.pickResult(target, r)} />;
}

export function PlanScreen() {
  return <PlanPanel app={useRider()} />;
}

export function ArriveScreen() {
  return <ArrivePanel app={useRider()} />;
}

export function DetailScreen() {
  return <DetailPanel app={useRider()} />;
}

export function LiveScreen() {
  const app = useRider();
  if (!app.trip) {
    return (
      <div className="pt-2">
        <StateMessage icon={<Compass className="h-5 w-5" />} title="No trip in progress" action={<PrimaryButton onClick={() => app.go({ kind: "home" })}>Back to Home</PrimaryButton>}>
          Choose a trip and tap Start trip to be guided step by step.
        </StateMessage>
      </div>
    );
  }
  return <TripPanel app={app} trip={app.trip} setTrip={app.setTrip} />;
}

export function ArrivedScreen() {
  return <ArrivedPanel app={useRider()} />;
}

export function NearbyScreen() {
  return <NearbyPanel app={useRider()} />;
}

export function ParkingScreen() {
  const app = useRider();
  if (!app.campus) return <CampusPrompt app={app} what="Campus parking" />;
  if (app.bundleError) return <p className="py-6 text-body text-app-muted">{app.bundleError}</p>;
  return <ParkingPanel app={app} parking={app.parkingView.state} results={app.parkingView.results} near={app.parkingView.near} />;
}

export function NightScreen() {
  const app = useRider();
  if (!app.campus) return <CampusPrompt app={app} what="Night travel services" />;
  if (app.bundleError) return <p className="py-6 text-body text-app-muted">{app.bundleError}</p>;
  return <NightPanel app={app} />;
}

export function CarScreen() {
  return <ParkedPanel app={useRider()} />;
}

export function CarReturnScreen() {
  return <ReturnPanel app={useRider()} />;
}

export function StopScreen() {
  const app = useRider();
  const stop = app.view.kind === "stop" ? app.view.stop : null;
  // A stop link without its stop is not a screen: go to Services instead.
  useEffect(() => {
    if (!stop) app.go({ kind: "services" }, "full", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop]);
  return stop ? <StopPanel app={app} stop={stop} /> : null;
}
