import { Outlet, useLocation } from "react-router-dom";
import { Header } from "./header";
import { PortalSidebar } from "./portal-sidebar";
import { PortalPickerDrawer } from "@/features/portals/components/PortalPickerDrawer";
import { LateCheckInAlertModal } from "@/features/people/components/LateCheckInAlertModal";
import { AssistantLauncher } from "@/features/assistant/components/AssistantLauncher";
import { useAutomationScanner } from "@/features/automation/hooks/use-automation-scanner";
import { useSyncLastPortal } from "@/features/portals/hooks/use-sync-last-portal";
import { useMeetingReminders } from "@/features/meetings/hooks/use-meeting-reminders";
import { getPortalFromPath } from "@/lib/portal-permissions";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layout.store";

export function AppLayout({ children }: { children?: React.ReactNode } = {}) {
  useSyncLastPortal();
  useMeetingReminders();
  useAutomationScanner();
  const { pathname } = useLocation();
  const { sidebarCollapsed, portalPickerOpen, setPortalPickerOpen } =
    useLayoutStore();
  const portal = getPortalFromPath(pathname);
  const isPicker = portal === "picker";
  const showSidebar =
    portal === "tasks" ||
    portal === "crm" ||
    portal === "people" ||
    portal === "billing" ||
    portal === "chat" ||
    portal === "projects";

  return (
    <div className="min-h-screen bg-background print:bg-white print:min-h-0 print:p-0">
      {showSidebar && <PortalSidebar portal={portal} />}
      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-300",
          showSidebar && (sidebarCollapsed ? "md:ps-[5.5rem]" : "md:ps-72"),
          "print:ps-0 print:ms-0 print:min-h-0 print:block"
        )}
      >
        <Header
          hasPortalSidebar={showSidebar}
          sidebarCollapsed={sidebarCollapsed}
        />
        <main
          className={cn(
            "flex-1 pt-20 sm:pt-24",
            isPicker ? "px-5 pb-6 md:px-10 md:pb-10" : "px-5 pb-6 md:px-8 md:pb-8",
            "print:pt-0 print:p-0 print:m-0 print:block"
          )}
        >
          {children ?? <Outlet />}
        </main>
      </div>
      <PortalPickerDrawer
        isOpen={portalPickerOpen}
        onOpenChange={setPortalPickerOpen}
      />
      <LateCheckInAlertModal />
      {!isPicker && <AssistantLauncher />}
    </div>
  );
}
