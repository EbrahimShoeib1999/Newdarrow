import { useEffect } from "react";
import { useAuth } from "@/features/auth/context/auth-context";
import { useCompany } from "@/features/companies/context/company-context";
import { useAttendanceStore } from "@/stores/attendance.store";

export function AttendanceInitializer() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { companyId, isLoading: companyLoading } = useCompany();
  const { syncWithDb, cancelSync } = useAttendanceStore();

  useEffect(() => {
    const canSync =
      !isLoading &&
      !companyLoading &&
      isAuthenticated &&
      Boolean(user?.id) &&
      !user?.profileMissing &&
      user?.onboardingStatus !== "pending" &&
      Boolean(user?.companyId) &&
      user?.companyId === companyId;

    if (canSync && user && companyId) {
      void syncWithDb(companyId, user.id);
    } else {
      cancelSync();
    }
  }, [
    isAuthenticated,
    isLoading,
    companyLoading,
    user?.id,
    user?.companyId,
    user?.profileMissing,
    user?.onboardingStatus,
    companyId,
    syncWithDb,
    cancelSync,
  ]);

  return null;
}
