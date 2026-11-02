/**
 * Unified back navigation bar (Phase 6b).
 *
 * One shared surface for the in-app "Back" control and the breadcrumb trail,
 * resolved entirely through the route-navigation registry so every portal gets
 * the same behavior and the same authorization contract:
 * - the registry decides WHETHER the bar renders at all (bar "none" pages keep
 *   the back controls / breadcrumbs they already own — nothing is duplicated);
 * - "full" renders the back button plus the trail, "crumbs" renders the trail
 *   only for pages that already own a correct back link;
 * - every target is filtered by the activity registry AND the user's effective
 *   permissions, so the trail never advertises a module the user cannot open.
 *
 * Mounted by the layouts that own page headers (PortalPageShell for portals,
 * SettingsLayout for the platform-settings section) — never per page.
 */

import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import { Button } from "@heroui/react";
import { hasRealBackHistory } from "@/lib/navigation-history";
import {
  buildBreadcrumbChain,
  getLastInAppOrigin,
  getPortalRootNavLabelKey,
  getPortalRootPath,
  isSafeNavTarget,
  resolveRouteNavRule,
  resolveSmartBackTarget,
  type BackAccess,
} from "@/lib/route-navigation";
import type { PortalId } from "@/lib/portal-permissions";
import type { Permission } from "@/lib/permissions";
import { useActivityConfig } from "@/features/activities/hooks/use-activity-config";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { PORTAL_META } from "@/features/portals/constants/portal-meta";

/**
 * The client-side BackAccess pair: effective permissions (the same source the
 * sidebar filters with) layered over the tenant's activity decision. Kept
 * private so this module only exports a component (fast-refresh contract).
 */
function useBackAccess(): BackAccess {
  const { can } = useAppPermissions();
  const config = useActivityConfig();
  return { can: (permission: string) => can(permission as Permission), config };
}

export function BackBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const access = useBackAccess();

  const rule = resolveRouteNavRule(pathname);
  if (!rule || rule.bar === "none") return null;
  // A page the user is not allowed to be on (disabled activity, portal the role
  // cannot open) renders its own denial state. Decorating it with navigation
  // would offer routes behind the denial, so the bar stays off entirely.
  if (!isSafeNavTarget(pathname, access)) return null;

  // The trail: portal landing (prepended here) + registry ancestry + the page
  // itself. The current page is the terminal crumb (never a link); every step
  // before it stays clickable, so "People › Company Settings › Team Members"
  // reads as an actual path instead of ending on an ancestor.
  const isRtl = i18n.dir() === "rtl";
  const landing = getPortalRootPath(rule.portal as PortalId);
  const atLanding = normalize(pathname) === landing;
  const landingLabel = getPortalRootNavLabelKey(rule.portal as PortalId)
    ?? t(PORTAL_META[rule.portal as PortalId].titleKey);
  const chain = atLanding ? [] : buildBreadcrumbChain(pathname, access);
  const currentLabel = rule.labelKey ? t(rule.labelKey) : landingLabel;
  const steps = [
    { path: landing, label: landingLabel },
    ...chain.map((s) => ({ path: s.path, label: t(s.labelKey) })),
    ...(atLanding ? [] : [{ path: normalize(pathname), label: currentLabel }]),
  ];

  // The icon itself flips with the direction (same convention as PageHeader),
  // so it must not also carry the rtl rotate utility.
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  // Resolved at PRESS time, never at render time: AppLayout records the page we
  // came from in an effect that runs AFTER this component renders, so a render
  // snapshot would always be one navigation behind (and would fall back to the
  // registry parent on the very first render of a newly opened page).
  // True history wins whenever the shell mirrored a real in-app previous
  // entry (global Back/Forward, same visit order across portals); the smart
  // registry fallback only answers direct entry / refresh, where no history
  // exists to walk.
  const goBack = () => {
    if (hasRealBackHistory()) {
      navigate(-1);
      return;
    }
    navigate(resolveSmartBackTarget(pathname, getLastInAppOrigin(), access));
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="back-bar" data-bar-mode={rule.bar}>
      {rule.bar === "full" && (
        <Button
          size="sm"
          variant="light"
          className="shrink-0 rounded-full font-semibold ps-2"
          startContent={<BackIcon className="h-4 w-4" />}
          onPress={goBack}
          aria-label={t("actions.back")}
          data-testid="back-button"
        >
          {t("actions.back")}
        </Button>
      )}
      <nav aria-label={t("nav.breadcrumbs")} className="flex flex-wrap items-center gap-1 text-xs font-semibold text-default-500">
        {steps.map((step, i) => (
          <span key={step.path} className="flex items-center gap-1">
            {i > 0 && (
              <ChevronRight className="h-3 w-3 shrink-0 rtl:rotate-180" aria-hidden="true" />
            )}
            {i === steps.length - 1 ? (
              <span className="text-default-700" aria-current="page">
                {step.label}
              </span>
            ) : (
              <Link to={step.path} className="transition-colors hover:text-primary">
                {step.label}
              </Link>
            )}
          </span>
        ))}
      </nav>
    </div>
  );
}

function normalize(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}
