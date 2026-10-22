import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  CardBody,
  Divider,
  Input,
} from "@heroui/react";
import { Save, RotateCcw } from "lucide-react";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import {
  useProjectSettings,
  useProjectT,
  useUpdateProjectTerminologyMutation,
} from "../hooks/use-project-terminology";
import {
  DEFAULT_TERMINOLOGY,
  projectTerminologySchema,
  type ProjectTerminology,
} from "../schemas/project-settings.schema";

/**
 * Tenant-scoped Projects module settings. Currently: display terminology only.
 * Renaming affects labels exclusively — routes, collections, permissions and
 * API contracts stay "projects" forever.
 */
export function ProjectSettingsPage() {
  const { i18n } = useTranslation();
  const { t } = useProjectT();
  const { can } = useAppPermissions();
  const canManage = can("projects.manage");
  const { data: settings } = useProjectSettings();
  const updateTerminology = useUpdateProjectTerminologyMutation();

  const [form, setForm] = useState<ProjectTerminology>(DEFAULT_TERMINOLOGY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setForm(settings?.terminology ?? DEFAULT_TERMINOLOGY);
  }, [settings]);

  const setField = (path: "singular.en" | "singular.ar" | "plural.en" | "plural.ar", value: string) => {
    const [num, lang] = path.split(".") as ["singular" | "plural", "en" | "ar"];
    setForm((prev) => ({ ...prev, [num]: { ...prev[num], [lang]: value } }));
  };

  const save = async () => {
    const parsed = projectTerminologySchema.safeParse(form);
    if (!parsed.success) {
      const flat: Record<string, string> = {};
      for (const issue of parsed.error.issues) flat[issue.path.join(".")] = issue.message;
      setErrors(flat);
      return;
    }
    setErrors({});
    await updateTerminology.mutateAsync(parsed.data);
  };

  const revertDefaults = async () => {
    setErrors({});
    await updateTerminology.mutateAsync(null);
    setForm(DEFAULT_TERMINOLOGY);
  };

  const isCustom = !!settings?.terminology;
  const previewLang = i18n.language?.startsWith("ar") ? "ar" : "en";

  return (
    <div className="max-w-2xl pb-20 animate-in fade-in duration-300">
      <h1 className="text-2xl font-black tracking-tight">{t("settings.title")}</h1>
      <p className="mb-5 text-sm text-default-500">{t("settings.terminologyHint")}</p>

      <Card className="border border-default-100">
        <CardBody className="gap-4">
          <p className="text-sm font-extrabold">{t("settings.terminologySection")}</p>
          <p className="text-[11px] text-default-400">{t("settings.examples")}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label={t("settings.singularEn")}
              value={form.singular.en}
              onValueChange={(v) => setField("singular.en", v)}
              isDisabled={!canManage}
              isInvalid={!!errors["singular.en"]}
              errorMessage={errors["singular.en"]}
              maxLength={40}
            />
            <Input
              label={t("settings.pluralEn")}
              value={form.plural.en}
              onValueChange={(v) => setField("plural.en", v)}
              isDisabled={!canManage}
              isInvalid={!!errors["plural.en"]}
              errorMessage={errors["plural.en"]}
              maxLength={40}
            />
            <Input
              label={t("settings.singularAr")}
              value={form.singular.ar}
              onValueChange={(v) => setField("singular.ar", v)}
              isDisabled={!canManage}
              isInvalid={!!errors["singular.ar"]}
              errorMessage={errors["singular.ar"]}
              maxLength={40}
            />
            <Input
              label={t("settings.pluralAr")}
              value={form.plural.ar}
              onValueChange={(v) => setField("plural.ar", v)}
              isDisabled={!canManage}
              isInvalid={!!errors["plural.ar"]}
              errorMessage={errors["plural.ar"]}
              maxLength={40}
            />
          </div>

          <Divider />

          <p className="text-sm">
            {t("settings.preview", {
              previewAdd: `New ${form.singular[previewLang]}`,
            })}
          </p>

          {canManage && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                color="primary"
                className="font-semibold"
                startContent={<Save className="h-4 w-4" />}
                isLoading={updateTerminology.isPending}
                onPress={save}
              >
                {t("settings.save")}
              </Button>
              {isCustom && (
                <Button
                  variant="light"
                  startContent={<RotateCcw className="h-4 w-4" />}
                  onPress={revertDefaults}
                >
                  {t("settings.useDefaults")}
                </Button>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
