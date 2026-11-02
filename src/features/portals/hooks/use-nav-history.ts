/**
 * Router-integrated navigation history tracker + read-model for the shared
 * header Back/Forward controls.
 *
 * Mounted once by AppLayout (the shell every protected page renders through),
 * so it observes every PUSH / POP / REPLACE the router performs — including
 * navigations that bypass the shared chrome (sidebar, Link, programmatic).
 * The mirror in navigation-history.ts stays a projection of router events,
 * never an independent history.
 */

import { useEffect } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { useSyncExternalStore } from "react";
import {
  applyNavigation,
  getNavHistorySnapshot,
  readNavHistory,
  resetNavHistory,
  subscribeNavHistory,
} from "@/lib/navigation-history";
import { useAuthStore } from "@/stores/auth.store";

export function useNavHistory() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  // Identity/session boundaries: logging out, switching company or account in
  // the same tab must never leave the previous tenant's trail navigable.
  const userId = useAuthStore((s) => s.user?.id);
  const companyId = useAuthStore((s) => s.user?.companyId);

  // Fold the transition that produced the current location into the mirror.
  // Runs after commit — the same location the pages just rendered against.
  useEffect(() => {
    applyNavigation({
      type: navigationType,
      key: location.key,
      url: `${location.pathname}${location.search}${location.hash}`,
    });
  }, [location.key, location.pathname, location.search, location.hash, navigationType]);

  // Wipe the mirrored stack whenever the authenticated context changes; the
  // mount effect above immediately reseeds it with the landing location.
  useEffect(() => {
    resetNavHistory();
    applyNavigation({
      type: "PUSH",
      key: location.key,
      url: `${location.pathname}${location.search}${location.hash}`,
    });
    // Only identity changes should re-run this — location is the seed value,
    // not a dependency to react to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, companyId]);

  const state = useSyncExternalStore(subscribeNavHistory, getNavHistorySnapshot);
  const { canBack, canForward } = readNavHistory(state);

  return {
    canBack,
    canForward,
    back: () => navigate(-1),
    forward: () => navigate(1),
  };
}
