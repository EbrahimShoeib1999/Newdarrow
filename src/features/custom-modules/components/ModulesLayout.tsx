import { Outlet } from "react-router-dom";
import { PortalGuard } from "@/features/portals/components/PortalGuard";
import { PortalPageShell } from "@/features/portals/components/PortalPageShell";

/**
 * Custom-modules mount — same shell contract as facilities/agency/REM: the
 * portal permission gate wraps the workspace, and PortalPageShell supplies
 * the registry-driven BackBar (route-navigation rules for /modules/*).
 */
export function ModulesLayout() {
  return (
    <PortalGuard portal="custom_modules">
      <PortalPageShell portal="custom_modules" maxWidth="wide">
        <Outlet />
      </PortalPageShell>
    </PortalGuard>
  );
}
