/**
 * In-app navigation origin tracker (Phase 6b §4B).
 *
 * The smart-back resolver needs to know where the user came FROM, which only
 * the layout that renders every portal page can observe reliably. Recorded
 * here (single central point) instead of per page:
 * - only PUSH navigations count, so a browser Back/Refresh never rewrites the
 *   origin into a loop (POP already came from the page we are leaving);
 * - the previous page is stored only when it is a real in-app destination the
 *   user could legitimately return to (portal-owned + activity-allowed), so
 *   external entry, the picker and denied/inactive pages are never targets;
 * - the query string is kept, so returning to a list restores its filters.
 */

import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { isRecordableNavOrigin, recordInAppOrigin } from "@/lib/route-navigation";
import { useActivityConfig } from "@/features/activities/hooks/use-activity-config";

export function useRecordNavOrigin() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const config = useActivityConfig();
  // The location rendered BEFORE the current one — that is the back target.
  const previous = useRef<{ pathname: string; search: string } | null>(null);
  const visited = useRef<string>("");

  useEffect(() => {
    const key = `${location.pathname}${location.search}`;
    if (visited.current === key) return; // re-render of the same location
    if (
      navigationType === "PUSH" &&
      previous.current &&
      isRecordableNavOrigin(previous.current.pathname, config)
    ) {
      recordInAppOrigin(previous.current);
    }
    visited.current = key;
    previous.current = { pathname: location.pathname, search: location.search };
  }, [location.pathname, location.search, navigationType, config]);
}
