import { Outlet } from "react-router-dom";
import { PortalGuard } from "@/features/portals/components/PortalGuard";
import { PortalPageShell } from "@/features/portals/components/PortalPageShell";

export function ProjectsLayout() {
  return (
    <PortalGuard portal="projects">
      <PortalPageShell portal="projects" maxWidth="wide">
        <Outlet />
      </PortalPageShell>
    </PortalGuard>
  );
}
