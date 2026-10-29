import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Divider } from "@heroui/react";
import { Plus, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { useModuleDefinitions, useModuleLifecycleMutation } from "../hooks/use-custom-modules";
import { templatesForActivity } from "../lib/module-templates";
import { moduleIcon } from "../lib/module-ui-helpers";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useActivityConfig } from "@/features/activities/hooks/use-activity-config";
import type { CustomModuleDefinition, ModuleLifecycle } from "../types/custom-module.types";

const LIFECYCLE_COLOR: Record<ModuleLifecycle, string> = {
  draft: "default",
  active: "success",
  archived: "warning",
};

/** The legal next lifecycle states mirror the service's transition table. */
const NEXT_LIFECYCLE: Record<ModuleLifecycle, ModuleLifecycle[]> = {
  draft: ["active"],
  active: ["archived"],
  archived: ["draft"],
};

export function ModuleConfigListPage() {
  const { t, i18n } = useTranslation("custom_modules");
  const lang = i18n.language === "ar" ? "ar" : "en";
  const { can, isAdmin } = useAppPermissions();
  const activityConfig = useActivityConfig();
  const canManage = isAdmin && can("custom_modules.manage_config");

  const { data: definitions = [], isLoading } = useModuleDefinitions();
  const lifecycle = useModuleLifecycleMutation();

  if (!canManage) {
    return (
      <Card>
        <CardBody className="gap-3 p-8 text-center">
          <Settings2 className="mx-auto h-10 w-10 text-danger" />
          <h2 className="text-lg font-bold">{t("config.title")}</h2>
          <p className="text-sm text-default-500">{t("config.denied")}</p>
        </CardBody>
      </Card>
    );
  }

  const templates = templatesForActivity(
    activityConfig.status === "ready" ? activityConfig.activity : null,
  );

  const transitionLabel = (next: ModuleLifecycle) =>
    next === "active" ? t("config.activate") : next === "archived" ? t("config.archiveConfig") : t("config.restoreConfig");

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("config.title")}
        description={t("config.subtitle")}
        actions={
          <Button as={Link} to="/modules/manage/new" color="primary" startContent={<Plus className="h-4 w-4" />}>
            {t("config.newModule")}
          </Button>
        }
      />

      {templates.length > 0 && (
        <Card>
          <CardBody className="gap-3">
            <p className="text-sm font-semibold text-default-600">{t("config.chooseTemplate")}</p>
            <div className="flex flex-wrap gap-2">
              {templates.map((tpl) => {
                const Icon = moduleIcon("Box");
                return (
                  <Button key={tpl.key} as={Link} to={`/modules/manage/new?template=${tpl.key}`} variant="bordered" size="sm" startContent={<Icon className="h-4 w-4" />}>
                    {lang === "ar" ? tpl.nameAr : tpl.nameEn}
                  </Button>
                );
              })}
              <Button as={Link} to="/modules/manage/new" variant="light" size="sm">
                {t("config.blank")}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("config.tableCols.module")}</th>
                <th className="px-4 py-2.5 text-start">{t("config.tableCols.lifecycle")}</th>
                <th className="px-4 py-2.5 text-start">{t("config.tableCols.fields")}</th>
                <th className="px-4 py-2.5 text-start">{t("config.tableCols.updatedAt")}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-default-400">
                    <LoadingSpinner size="sm" />
                  </td>
                </tr>
              ) : definitions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-default-400">{t("workspace.empty")}</td>
                </tr>
              ) : (
                definitions.map((def: CustomModuleDefinition) => (
                  <tr key={def.key} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                    <td className="px-4 py-2.5">
                      <Link to={`/modules/manage/${def.key}`} className="flex items-center gap-2 font-medium text-primary">
                        {def.name[lang]}
                        <span className="text-xs text-default-400">{def.key}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Chip size="sm" variant="flat" color={LIFECYCLE_COLOR[def.lifecycle] as never}>
                        {t(`config.lifecycle.${def.lifecycle}`)}
                      </Chip>
                    </td>
                    <td className="px-4 py-2.5 text-default-600 tabular-nums">{def.fields.length}</td>
                    <td className="px-4 py-2.5 text-xs text-default-500">
                      {def.updatedAt ? new Date(def.updatedAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-end">
                      <Button as={Link} size="sm" variant="light" to={`/modules/manage/${def.key}`}>
                        {t("config.edit")}
                      </Button>
                      {NEXT_LIFECYCLE[def.lifecycle].map((next) => (
                        <Button
                          key={next}
                          size="sm"
                          variant={next === "archived" ? "light" : "flat"}
                          color={next === "active" ? "success" : next === "archived" ? "danger" : "default"}
                          isLoading={lifecycle.isPending}
                          onPress={() => lifecycle.mutate({ key: def.key, lifecycle: next, expectedRevision: def.revision })}
                        >
                          {transitionLabel(next)}
                        </Button>
                      ))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Divider />
      <p className="text-xs text-default-400">{t("config.deleteBlockNote")}</p>
    </div>
  );
}
