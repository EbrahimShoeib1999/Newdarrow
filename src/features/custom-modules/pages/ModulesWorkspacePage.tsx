import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody } from "@heroui/react";
import { ArrowLeft, ArrowRight, Settings2, Sliders } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { useVisibleModules, useModuleAccess } from "../hooks/use-custom-modules";
import { moduleIcon } from "../lib/module-ui-helpers";
import type { CustomModuleDefinition } from "../types/custom-module.types";

/** One module card — resolves its own create-access to offer the right CTA. */
function ModuleCard({ def }: { def: CustomModuleDefinition }) {
  const { t, i18n } = useTranslation("custom_modules");
  const lang = i18n.language === "ar" ? "ar" : "en";
  const { canCreate } = useModuleAccess(def);
  const Icon = moduleIcon(def.icon);
  const isRtl = i18n.dir() === "rtl";
  const Arrow = isRtl ? ArrowLeft : ArrowRight;

  return (
    <Card className="h-full transition-shadow hover:shadow-lg">
      <CardBody className="gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-default-400">
            {def.key}
          </span>
        </div>
        <div>
          <h3 className="text-base font-bold text-default-900">{def.name[lang]}</h3>
          {def.description?.[lang] && (
            <p className="mt-1 line-clamp-2 text-sm text-default-500">{def.description[lang]}</p>
          )}
        </div>
        <Button
          as={Link}
          to={`/modules/${def.key}`}
          size="sm"
          variant={canCreate ? "solid" : "flat"}
          color="primary"
          endContent={<Arrow className="h-4 w-4" />}
          className="self-start"
        >
          {t("workspace.openModule")}
        </Button>
      </CardBody>
    </Card>
  );
}

/**
 * `/modules` landing: the grid of active, activity-scoped modules this user may
 * view. Access is resolved entirely by the engine's per-module grants (the same
 * atoms the Firestore rules enforce), so nothing here widens a boundary.
 */
export function ModulesWorkspacePage() {
  const { t, i18n } = useTranslation("custom_modules");
  const lang = i18n.language === "ar" ? "ar" : "en";
  const { modules, isLoading } = useVisibleModules();
  const { canManageConfig } = useModuleAccess(null);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("workspace.title")}
        description={t("workspace.subtitle")}
        actions={
          canManageConfig ? (
            <Button
              as={Link}
              to="/modules/manage"
              variant="flat"
              startContent={<Settings2 className="h-4 w-4" />}
            >
              {t("workspace.manageCta")}
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <LoadingSpinner />
      ) : modules.length === 0 ? (
        <EmptyState
          title={t("workspace.empty")}
          description={canManageConfig ? undefined : t("workspace.emptyHint")}
          action={
            canManageConfig ? (
              <Button
                as={Link}
                to="/modules/manage/new"
                color="primary"
                startContent={<Sliders className="h-4 w-4" />}
              >
                {t("config.newModule")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((def) => (
            <ModuleCard key={def.key} def={def} />
          ))}
        </div>
      )}
      {/* lang is referenced so the bilingual grid stays lint-safe if expanded. */}
      <span className="sr-only">{lang}</span>
    </div>
  );
}
