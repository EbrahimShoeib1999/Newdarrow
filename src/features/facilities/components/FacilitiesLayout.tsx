import { Outlet } from "react-router-dom";
import { PortalGuard } from "@/features/portals/components/PortalGuard";
import { PortalPageShell } from "@/features/portals/components/PortalPageShell";

export function FacilitiesLayout() {
  return (
    <PortalGuard portal="facilities">
      <PortalPageShell portal="facilities" maxWidth="wide">
        <Outlet />
      </PortalPageShell>
    </PortalGuard>
  );
}
