import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { PortalId } from "@/lib/portal-permissions";
import { PortalSubNav } from "@/features/portals/components/PortalSubNav";
import { BackBar } from "@/components/shared/back-bar";

function isFullBleedPath(pathname: string) {
  if (pathname.startsWith("/chat")) return true;
  if (pathname.startsWith("/tasks/work")) return true;
  if (pathname === "/crm/deals" || pathname === "/crm/deals/") return true;
  return false;
}

interface PortalPageShellProps {
  portal: PortalId;
  maxWidth?: "7xl" | "wide";
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}

export function PortalPageShell({
  portal,
  maxWidth = "7xl",
  toolbar,
  children,
}: PortalPageShellProps) {
  const { pathname } = useLocation();
  const fullBleed = isFullBleedPath(pathname);

  return (
    <div
      className={cn(
        "portal-workspace animate-in fade-in slide-in-from-bottom-4 duration-500 w-full min-w-0 mx-auto flex flex-col",
        fullBleed
          ? "-mx-4 max-w-none min-w-0 md:-mx-6 md:h-[calc(100dvh-var(--header-height)-3.5rem)] md:min-h-0 md:overflow-hidden"
          : maxWidth === "wide"
            ? "max-w-[1600px]"
            : "max-w-7xl"
      )}
    >
      <div
        className={cn(
          "md:hidden shrink-0 sticky top-[var(--header-height)] z-30 -mx-4 px-4 py-2 glass border-b border-default-100/80 shadow-sm",
          fullBleed ? "mb-2" : "mb-4"
        )}
      >
        <PortalSubNav portal={portal} />
      </div>

      {/* Registry-driven unified back + breadcrumbs. Renders nothing on pages
      that already own their controls (bar "none"), so nothing duplicates. */}
      {!fullBleed && <BackBar />}

      {toolbar && (
        <div className="shrink-0 mb-3 flex items-center gap-2 flex-wrap sm:justify-end">
          {toolbar}
        </div>
      )}

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          fullBleed && "md:min-h-0 md:overflow-hidden"
        )}
      >
        {children}
      </div>
    </div>
  );
}
