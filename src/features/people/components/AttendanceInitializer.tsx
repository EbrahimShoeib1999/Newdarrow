import { useEffect } from "react";
import { useAuth } from "@/features/auth/context/auth-context";
import { useCompany } from "@/features/companies/context/company-context";
import { useAttendanceStore } from "@/stores/attendance.store";

export function AttendanceInitializer() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { companyId } = useCompany();
  const { syncWithDb, stopTimer } = useAttendanceStore();

  useEffect(() => {
    if (isAuthenticated && user?.id && companyId) {
      console.log(`[AttendanceInitializer] Triggering sync for user: ${user.id}`);
      syncWithDb(companyId, user.id);
    } else if (!isLoading && !isAuthenticated) {
      // Only a confirmed signed-out state stops the timer. While Firebase is
      // still restoring the persisted session, neither branch applies — the
      // previous "not authenticated" log here was misleading during normal
      // initialization and did not reflect a real signed-out user.
      console.log("[AttendanceInitializer] Signed out, stopping timer");
      stopTimer();
    }
  }, [isAuthenticated, isLoading, user?.id, companyId, syncWithDb, stopTimer]);

  return null;
}
