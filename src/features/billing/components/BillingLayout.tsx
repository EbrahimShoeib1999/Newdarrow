import { Outlet } from "react-router-dom";
import { PortalGuard } from "@/features/portals/components/PortalGuard";

export function BillingLayout() {
  return (
    <PortalGuard portal="billing">
      <div className="flex h-full flex-col">
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </PortalGuard>
  );
}
