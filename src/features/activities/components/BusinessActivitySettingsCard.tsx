/**
 * Business activity selector — the tenant's primary activity configuration.
 *
 * Rendered inside Company Settings behind the `company.manage` permission.
 * Selecting an activity re-points the entire application experience (routes,
 * navigation, dashboards, homepage shortcuts, search) through the central
 * activity registry. Saving:
 * 1. persists the stable id on the company profile (Firestore rules validate
 *    it and restrict changes to company admins);
 * 2. refreshes the authoritative activity state in this client;
 * 3. invalidates activity-scoped caches so no stale domain data survives;
 * and it never deletes, converts or rewrites any existing record.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, CardHeader } from "@heroui/react";
import { CheckCircle2, Circle, Info } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ACTIVITY_ID_LIST, type ActivityId } from "../types/activity.types";
import { useActivityConfig, useUpdatePrimaryActivityMutation } from "../hooks/use-activity-config";

export function BusinessActivitySettingsCard() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("ar") ? "ar" : "en";
  const config = useActivityConfig();
  const current = config.status === "ready" ? config.activity : null;
  const [draft, setDraft] = useState<ActivityId | null>(current);
  const mutation = useUpdatePrimaryActivityMutation();

  // Follow the authoritative value when it lands or changes elsewhere
  // (another admin's update, an activity switch while this page is open).
  // Adjusting state during render (guarded) avoids a cascading effect pass.
  const [prevCurrent, setPrevCurrent] = useState(current);
  if (current !== prevCurrent) {
    setPrevCurrent(current);
    setDraft(current);
  }

  const dirty = draft !== null && draft !== current;

  const onSave = async () => {
    if (!draft) return;
    try {
      await mutation.mutateAsync(draft);
      toast.success(t("activity.saved"));
    } catch {
      toast.error(t("activity.saveError"));
    }
  };

  return (
    <Card className="border border-default-200/80">
      <CardHeader className="flex-col items-start gap-1">
        <h2 className="text-base font-black">{t("activity.settingsTitle")}</h2>
        <p className="text-sm text-default-500">{t("activity.settingsSubtitle")}</p>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {ACTIVITY_ID_LIST.map((meta) => {
            const selected = draft === meta.id;
            return (
              <button
                key={meta.id}
                type="button"
                onClick={() => setDraft(meta.id)}
                aria-pressed={selected}
                // Stable automation hook: browser E2E selects a card by its
                // registry id instead of the rendered (translated) label.
                data-activity-id={meta.id}
                className={cn(
                  "flex items-start gap-3 rounded-2xl border p-4 text-start transition-all",
                  selected
                    ? "border-primary bg-primary/[0.06] ring-1 ring-primary/30 shadow-sm"
                    : "border-default-200 hover:border-primary/40 hover:bg-default-50"
                )}
              >
                {selected ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                ) : (
                  <Circle className="mt-0.5 h-5 w-5 shrink-0 text-default-300" />
                )}
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-foreground">
                    {meta.labels[lang]}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-default-500">
                    {meta.description[lang]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-start gap-2 rounded-xl bg-default-50 p-3 text-xs text-default-500 border border-default-100">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t("activity.switchNote")}</p>
        </div>

        <div className="flex items-center justify-end gap-2">
          {dirty && draft && (
            <Button
              size="sm"
              variant="flat"
              onPress={onSave}
              isLoading={mutation.isPending}
              className="font-bold"
              // Stable automation hook for the activity-switch E2E.
              data-slot="activity-save"
            >
              {t("activity.save", { name: ACTIVITY_ID_LIST.find((m) => m.id === draft)!.labels[lang] })}
            </Button>
          )}
          {!dirty && current && (
            <span className="text-xs font-semibold text-default-400">
              {t("activity.current")}:{ACTIVITY_ID_LIST.find((m) => m.id === current)!.labels[lang]}
            </span>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
