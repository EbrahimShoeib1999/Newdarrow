/**
 * Activity-aware route guard.
 *
 * Mounted around every activity-owned route element (and around reserved
 * domain prefixes that have no pages yet). It renders the decision produced
 * by `resolveRouteAccess` — the exact same pure function the navigation
 * filters use — so:
 * - protected content is NEVER rendered while auth / tenant / activity state
 *   is still resolving (no flash, direct URL or not);
 * - an inactive activity's pages show an explicit access-denied state instead
 *   of the module, even when the URL is typed by hand;
 * - an active activity whose domain module has not shipped yet gets a clear
 *   "setup pending" page rather than an unrelated module or a silent 404.
 */

import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardBody } from "@heroui/react";
import { Construction, Home, ShieldAlert } from "lucide-react";
import { resolveRouteAccess } from "@/lib/activity-routes";
import { ACTIVITY_REGISTRY, activityLabel } from "../types/activity.types";
import { useActivityConfig } from "../hooks/use-activity-config";

function RouteLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

/** Same visual language as the portal access denial (PortalGuard). */
function DeniedCard({ title, body }: { title: string; body: string }) {
  return (
    <Card className="mx-auto mt-12 max-w-lg border border-danger/20">
      <CardBody className="space-y-3 p-8 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-danger" />
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="text-sm text-default-500">{body}</p>
        <BackToAppsLink />
      </CardBody>
    </Card>
  );
}

function BackToAppsLink() {
  const { t } = useTranslation();
  return (
    <Link
      to="/apps"
      className="inline-flex items-center gap-2 rounded-xl bg-default-100 px-4 py-2 text-sm font-semibold text-default-700 transition-colors hover:bg-default-200"
    >
      <Home className="h-4 w-4" />
      {t("activity.backToApps")}
    </Link>
  );
}

export function ActivityRouteGuard({ children }: { children?: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const config = useActivityConfig();
  const lang = i18n.language?.startsWith("ar") ? "ar" : "en";

  const decision = resolveRouteAccess(location.pathname, config);

  switch (decision) {
    case "loading":
      // Fail closed: nothing about the protected page renders until the
      // authoritative activity configuration resolves.
      return <RouteLoader />;

    case "deny-activity":
      return (
        <DeniedCard title={t("activity.deniedTitle")} body={t("activity.deniedBody")} />
      );

    case "configuring": {
      // The prefix belongs to the ACTIVE activity, but its pages ship in a
      // later module phase. Never render an unrelated module here.
      const owner = Object.values(ACTIVITY_REGISTRY).find((m) =>
        location.pathname === m.routeBase || location.pathname.startsWith(`${m.routeBase}/`),
      );
      return (
        <Card className="mx-auto mt-12 max-w-lg border border-primary/20">
          <CardBody className="space-y-3 p-8 text-center">
            <Construction className="mx-auto h-10 w-10 text-primary" />
            <h2 className="text-lg font-bold">
              {owner ? activityLabel(owner.id, lang) : ""} — {t("activity.configuringTitle")}
            </h2>
            <p className="text-sm text-default-500">{t("activity.configuringBody")}</p>
            <BackToAppsLink />
          </CardBody>
        </Card>
      );
    }

    case "not-found":
      // Unowned namespace inside the guarded subtree — fall through to the
      // standard 404 copy via the parent layout's wildcard sibling is not
      // possible from here, so render the equivalent message inline.
      return (
        <Card className="mx-auto mt-12 max-w-lg border border-default-200">
          <CardBody className="space-y-3 p-8 text-center">
            <h2 className="text-lg font-bold">{t("notFound.comingSoon")}</h2>
            <p className="text-sm text-default-500">{t("notFound.description")}</p>
            <BackToAppsLink />
          </CardBody>
        </Card>
      );

    case "allow":
    default:
      return <>{children}</>;
  }
}
