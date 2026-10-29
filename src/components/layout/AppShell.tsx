import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AmbientBackground } from "./AmbientBackground";
import { TopBar } from "./TopBar";
import { FloatingDock } from "./FloatingDock";
import { AccountingOrbit } from "./AccountingOrbit";
import { MoreSheet } from "./MoreSheet";
import { QuickModals } from "../domain/QuickModals";
import { GlobalHotkeys } from "./GlobalHotkeys";
import { useRegisterPwaUpdate } from "../../pwa/usePwaUpdate";
import { forceUnlockBodyScroll } from "../ui/Modal";
import { RobotCompanion } from "../robot/RobotCompanion";

/** Application shell: background, top bar, routed content and floating dock. */
export function AppShell() {
  const location = useLocation();
  useRegisterPwaUpdate();

  // Scroll to top on navigation (dock + bottom sheets assume top-anchored pages).
  // Also self-heal the body scroll lock: even if some dialog ever left it stuck,
  // moving between sections always brings the scrollbar back (no refresh needed).
  useEffect(() => {
    forceUnlockBodyScroll();
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="flex min-h-dvh flex-col">
      <AmbientBackground />
      <TopBar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-[max(7.5rem,calc(env(safe-area-inset-bottom)+7.5rem))] sm:px-6">
        <div key={location.pathname} className="page-enter">
          <Outlet />
        </div>
      </main>
      <FloatingDock />
      <AccountingOrbit />
      <MoreSheet />
      <QuickModals />
      <GlobalHotkeys />
      <RobotCompanion />
    </div>
  );
}
