import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Select, SelectItem } from "@heroui/react";
import { selectFieldProps } from "@/components/shared/select-field";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { EmptyState } from "@/components/shared/empty-state";
import {
  useModuleDefinition,
  useModuleAccess,
  useModuleRecord,
  useCreateRecordMutation,
  useUpdateRecordMutation,
  useRelationOptions,
} from "../hooks/use-custom-modules";
import { canMoveStage, stageLabel } from "../lib/module-engine";
import { fieldErrorText, errorsByField } from "../lib/module-ui-helpers";
import { FieldRenderer } from "../components/FieldRenderer";
import { ModuleValidationError } from "../api/custom-modules.service";
import type {
  FieldError,
  ModuleFieldDefinition,
  ModuleRecord,
} from "../types/custom-module.types";

/** One field row: resolves its own relation options through the hook (a hook
 * cannot be called inside a loop, so the picker lives in this child). */
function FormField({
  field,
  value,
  onChange,
  errorText,
  disabled,
}: {
  field: ModuleFieldDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
  errorText?: string;
  disabled?: boolean;
}) {
  const isRelation = field.type === "relation";
  const { data: options } = useRelationOptions(isRelation ? field : null);
  return (
    <FieldRenderer
      field={field}
      value={value}
      onChange={onChange}
      relationOptions={options}
      errorText={errorText}
      disabled={disabled}
    />
  );
}

/** Map a thrown engine/service error to a renderable form message. */
function generalError(err: unknown, t: (k: string) => string): string | null {
  if (err instanceof ModuleValidationError) return null; // field-level only
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === "stale_revision") return t("form.staleConflict");
  if (msg === "record_archived") return t("form.archivedBlocked");
  return t("errors.unknown");
}

/**
 * Create/edit form for a configurable record. The layout is driven entirely by
 * `def.fields`; the stage selector only offers transitions the engine deems
 * legal from the record's CURRENT status; and the payload is `{ values, status }`
 * so protected fields can never be mass-assigned from the form.
 */
export function ModuleRecordFormPage() {
  const { moduleKey, recordId } = useParams<{ moduleKey: string; recordId?: string }>();
  const isEdit = !!recordId;
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("custom_modules");
  const lang = i18n.language === "ar" ? "ar" : "en";

  const { data: def, isLoading: defLoading } = useModuleDefinition(moduleKey);
  const access = useModuleAccess(def);
  const { data: record, isLoading: recordLoading } = useModuleRecord(def, recordId ?? null);
  const createRecord = useCreateRecordMutation(def);
  const updateRecord = useUpdateRecordMutation(def);

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<string>("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [general, setGeneral] = useState<string | null>(null);

  // Hydrate the editor once the stored record arrives (edit) or the module
  // resolves its initial stage (create).
  useEffect(() => {
    if (!def) return;
    if (isEdit && record) {
      setValues({ ...record.values });
      setStatus(record.status);
    } else if (!isEdit) {
      setValues({});
      setStatus(def.initialStage);
    }
  }, [def, record, isEdit]);

  const stageOptions = useMemo(() => {
    if (!def) return [];
    const from = isEdit ? record?.status ?? def.initialStage : def.initialStage;
    return def.stages.filter((s) => s.key === from || canMoveStage(def.stages, from, s.key));
  }, [def, isEdit, record]);

  if (defLoading || (isEdit && recordLoading)) return <LoadingSpinner />;

  if (!def || !access.canView || (isEdit && !access.canUpdate) || (!isEdit && !access.canCreate)) {
    return (
      <EmptyState title={t("detail.notFoundTitle")} description={t("detail.notFoundBody")} />
    );
  }

  const byField = errorsByField(errors);
  const saving = createRecord.isPending || updateRecord.isPending;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!def) return;
    setErrors([]);
    setGeneral(null);
    const payload: Record<string, unknown> = { values, status };
    try {
      if (isEdit && record) {
        await updateRecord.mutateAsync({
          id: record.id,
          payload,
          expectedRevision: record.revision,
        });
        navigate(`/modules/${def.key}/${record.id}`);
      } else {
        const created: ModuleRecord = (await createRecord.mutateAsync(payload)) as ModuleRecord;
        navigate(`/modules/${def.key}/${created.id}`);
      }
    } catch (err) {
      if (err instanceof ModuleValidationError) {
        setErrors(err.errors);
      } else {
        setGeneral(generalError(err, (k) => t(k)));
      }
    }
  };

  const title = isEdit
    ? t("form.editTitle", { code: record?.code ?? record?.id ?? "" })
    : t("form.createTitle", { module: def.name[lang] });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-default-900">{title}</h1>
        <Button as={Link} to={`/modules/${def.key}`} variant="light" size="sm">
          {t("list.back")}
        </Button>
      </div>

      {general && (
        <div role="alert" className="rounded-lg border border-danger-300 bg-danger-50/60 p-3 text-sm font-semibold text-danger-600">
          {general}
        </div>
      )}
      {errors.length > 0 && !general && (
        <div role="alert" className="space-y-1 rounded-lg border border-warning-300 bg-warning-50/60 p-3 text-xs font-semibold text-warning-700">
          <p>{t("form.errorsIntro")}</p>
        </div>
      )}

      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {def.fields.map((field) => (
            <div key={field.key} className={field.type === "textarea" ? "sm:col-span-2" : undefined}>
              <FormField
                field={field}
                value={values[field.key]}
                onChange={(next) => setValues((v) => ({ ...v, [field.key]: next }))}
                errorText={byField[field.key] ? fieldErrorText(t, { fieldKey: field.key, reason: byField[field.key][0] }) : undefined}
                disabled={saving}
              />
            </div>
          ))}

          <div className="sm:col-span-2">
            <Select
              {...selectFieldProps()}
              label={t("form.stage")}
              selectedKeys={[status]}
              isDisabled={saving || stageOptions.length <= 1}
              onSelectionChange={(keys) => {
                const v = Array.from(keys)[0] as string | undefined;
                if (v) setStatus(v);
              }}
              errorMessage={byField["status"] ? t(`errors.${byField["status"][0]}`) : undefined}
            >
              {stageOptions.map((s) => (
                <SelectItem key={s.key}>{stageLabel(def, s.key, lang)}</SelectItem>
              ))}
            </Select>
          </div>
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="light" onPress={() => navigate(-1)} isDisabled={saving}>
          {t("common:actions.cancel")}
        </Button>
        <Button type="submit" color="primary" isLoading={saving}>
          {saving ? t("form.saving") : t("form.save")}
        </Button>
      </div>
    </form>
  );
}
