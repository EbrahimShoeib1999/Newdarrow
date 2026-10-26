import { Outlet } from "react-router-dom";
import { PortalGuard } from "@/features/portals/components/PortalGuard";
import { PortalPageShell } from "@/features/portals/components/PortalPageShell";

export function AgencyLayout() {
  return (
    <PortalGuard portal="agency">
      <PortalPageShell portal="agency" maxWidth="wide">
        <Outlet />
      </PortalPageShell>
    </PortalGuard>
  );
}
