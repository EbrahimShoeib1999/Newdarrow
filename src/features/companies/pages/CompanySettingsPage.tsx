import { useTranslation } from "react-i18next";
import { PermissionGuard } from "../components/PermissionGuard";
import { CompanyProfileForm } from "../components/CompanyProfileForm";
import { BusinessActivitySettingsCard } from "@/features/activities/components/BusinessActivitySettingsCard";
import { useAppPermissions } from "../hooks/use-app-permissions";

export function CompanySettingsPage() {
  const { t } = useTranslation("settings");
  const { can } = useAppPermissions();

  return (
    <PermissionGuard permission="company.view">
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-black">{t("company.pageTitle")}</h1>
          <p className="text-sm text-default-500">{t("company.pageSubtitle")}</p>
        </div>
        <CompanyProfileForm />
        {/* Primary business activity — admins only; drives activity-aware routing app-wide. */}
        {can("company.manage") && <BusinessActivitySettingsCard />}
      </div>
    </PermissionGuard>
  );
}
