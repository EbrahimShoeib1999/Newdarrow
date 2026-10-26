/**
 * Activity-aware route registry — the single authorization contract between
 * the tenant's persisted business activity and every URL in the app.
 *
 * Pure module (no React, no Firebase): the router, the navigation surfaces
 * (sidebar, launcher, picker, breadcrumbs, contextual links) and the unit
 * tests all resolve access through the same functions, so "hidden from
 * navigation" and "denied on direct URL" can never diverge.
 *
 * Rules encoded here:
 * - Shared routes (CRM, HR, accounting/invoices, settings, chat, tasks…) are
 *   available under every activity; role/portal permissions still apply on top.
 * - Activity-specific routes are available ONLY when their activity is the
 *   tenant's active one — otherwise they resolve to "deny", which the guards
 *   render as an access-denied state, never as the protected page.
 * - While authentication/tenant/activity state is unresolved every protected
 *   path resolves to "loading", so no protected content can flash.
 */

import {
  ACTIVITY_REGISTRY,
  type ActivityId,
} from "../features/activities/types/activity.types";
import type { PortalId } from "./portal-permissions";

/** Config resolution state for the current session. */
export type ActivityConfigState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; activity: ActivityId };

export type RouteDecision =
  /** Render the page. */
  | "allow"
  /** Config/auth/tenant still resolving — render nothing but a loader. */
  | "loading"
  /** The path belongs to an inactive activity — render the denied state. */
  | "deny-activity"
  /** Reserved by the ACTIVE activity but its pages are not shipped yet. */
  | "configuring"
  /** Nobody owns the path — render the standard 404. */
  | "not-found";

/**
 * Route prefixes of genuinely shared modules. Segment-matched (see
 * `ownedPrefix`), so `/crm` matches `/crm/deals/1` but never `/crm-help`.
 */
export const SHARED_ROUTE_PREFIXES: readonly string[] = [
  "/apps",
  "/tasks",
  "/crm",
  "/people",
  "/billing",
  "/chat",
  "/settings",
  "/meetings",
  "/profile",
  "/notifications",
  "/seed",
];

/**
 * Activity-owned route namespaces. Each activity reserves exactly one base
 * prefix; nested domain routes (`/clinic/patients/:id`, …) inherit ownership
 * automatically. PROJECTS additionally claims the legacy `/projects` module.
 */
export const ACTIVITY_ROUTE_PREFIXES: readonly string[] = Object.values(
  ACTIVITY_REGISTRY,
).map((meta) => meta.routeBase);

/** Which activity owns a portal app; unlisted portals are shared. */
export const PORTAL_ACTIVITY: Partial<Record<PortalId, ActivityId>> = {
  projects: "PROJECTS",
  facilities: "FACILITIES_MANAGEMENT",
  agency: "MARKETING_AGENCY",
};

/** Map an activity to the portal id whose page tree it owns (reverse lookup). */
export function activityPortal(activity: ActivityId): PortalId | null {
  for (const [portal, owner] of Object.entries(PORTAL_ACTIVITY)) {
    if (owner === activity) return portal as PortalId;
  }
  return null;
}

function prefixOf(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

/** Ownership of a pathname, independent of the active activity. */
export type RouteOwner =
  | { kind: "shared" }
  | { kind: "activity"; activity: ActivityId }
  | null;

/**
 * Longest-reserved-prefix match on whole path segments. A path can be owned
 * by at most one namespace; prefixes are disjoint by construction.
 */
export function matchRouteOwner(pathname: string): RouteOwner {
  const segments = prefixOf(pathname);
  if (segments.length === 0) return { kind: "shared" }; // "/" handled by the public routes
  const first = `/${segments[0]}`;
  for (const activityId of Object.keys(ACTIVITY_REGISTRY) as ActivityId[]) {
    if (ACTIVITY_REGISTRY[activityId].routeBase === first) {
      return { kind: "activity", activity: activityId };
    }
  }
  if (SHARED_ROUTE_PREFIXES.includes(first)) return { kind: "shared" };
  return null;
}

/**
 * The single decision function. Guards and navigation filters call this so a
 * link is displayable exactly when its target would render.
 */
export function resolveRouteAccess(
  pathname: string,
  config: ActivityConfigState,
): RouteDecision {
  if (config.status === "loading") return "loading";
  // An unresolvable activity config fails closed: never "allow" domain pages.
  if (config.status === "error") return "deny-activity";

  const owner = matchRouteOwner(pathname);
  if (owner === null) return "not-found";
  if (owner.kind === "shared") return "allow";
  if (owner.activity !== config.activity) return "deny-activity";
  return ACTIVITY_REGISTRY[owner.activity].moduleLive ? "allow" : "configuring";
}

/** Portals visible for an activity (permission filtering happens separately). */
export function portalAllowedForActivity(portal: PortalId, config: ActivityConfigState): boolean {
  const owner = PORTAL_ACTIVITY[portal];
  if (owner === undefined) return true; // shared portal
  if (config.status !== "ready") return false; // fail closed while unresolved
  return owner === config.activity;
}

/** Filter any list of navigation paths down to what the activity permits. */
export function filterPathsForActivity(
  paths: readonly string[],
  config: ActivityConfigState,
): string[] {
  return paths.filter((p) => {
    const owner = matchRouteOwner(p);
    if (owner === null || owner.kind === "shared") return true;
    return config.status === "ready" && owner.activity === config.activity;
  });
}
