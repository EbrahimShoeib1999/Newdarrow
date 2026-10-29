import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Divider, Input } from "@heroui/react";
import { ClipboardList, Search } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { formatDate } from "@/lib/utils";
import { useProperties, useRemActor, useUnits } from "../hooks/use-real-estate";
import {
  useFinalizeInspectionMutation,
  useInspections,
  useInspectionVersionMutation,
  useWorkOrderForIssueMutation,
} from "../hooks/use-real-estate-ops";
import { RemSelect } from "../components/RemSelect";
import { InspectionFormModal } from "../components/InspectionFormModal";
import { remErrorText } from "../lib/ui-maps";
import type { Inspection } from "../types/real-estate.types";

/**
 * Inspections register. Finalized evidence is immutable — corrections go
 * through a superseding version (same chain the service maintains). Issues
 * raise work orders via the FACILITIES module, never a parallel system.
 */
export function InspectionsListPage() {
  const { t } = useTranslation("real_estate");
  const { can } = useAppPermissions();
  const canCreate = can("real_estate.create");
  const actor = useRemActor();

  const { data: inspections = [], isLoading } = useInspections();
  const { data: properties = [] } = useProperties();
  const { data: units = [] } = useUnits();
  const finalize = useFinalizeInspectionMutation();
  const newVersion = useInspectionVersionMutation();
  const raiseWo = useWorkOrderForIssueMutation();

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Inspection | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const propById = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties]);
  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inspections
      .filter((i) => {
        if (typeFilter && i.type !== typeFilter) return false;
        if (!q) return true;
        return `${i.code} ${i.conditionNote ?? ""}`.toLowerCase().includes(q);
      })
      .sort((a, b) => (a.inspectionDate < b.inspectionDate ? 1 : -1));
  }, [inspections, query, typeFilter]);

  const run = (p: Promise<unknown>) => p.catch((e) => toast.error(remErrorText(t, e)));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" />
            {t("inspectionsPage.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("inspectionsPage.subtitle")}</p>
        </div>
        {canCreate && (
          <Button
            color="primary"
            onPress={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {t("inspectionsPage.formNew")}
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          size="sm"
          className="sm:max-w-xs"
          startContent={<Search className="w-4 h-4 text-default-400" />}
          placeholder={t("inspectionsPage.searchPlaceholder")}
          value={query}
          onValueChange={setQuery}
        />
        <RemSelect
          label={t("fields.type")}
          value={typeFilter}
          onChange={setTypeFilter}
          placeholderKey={t("misc.all")}
          options={["initial", "move_in", "periodic", "move_out", "final_handover"].map((v) => ({ id: v, label: t(`inspectionType.${v}`) }))}
        />
      </div>

      <Card>
        <CardBody>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-default-400 py-4">{t("inspectionsPage.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-default-500 border-b border-default-200">
                    <th className="px-2 py-2 text-start">{t("fields.code")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.type")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.date")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.property")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.unit")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.status")}</th>
                    <th className="px-2 py-2 text-end">{t("fields.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => (
                    <Fragment key={i.id}>
                      <tr className="border-b border-default-100 last:border-0 align-top">
                      <td className="px-2 py-2">
                        <button type="button" className="text-primary font-mono text-xs" onClick={() => setExpandedId(expandedId === i.id ? null : i.id)}>
                          {i.code}
                        </button>
                        {i.supersedesInspectionId && (
                          <div className="text-xs text-default-400">v{i.version}</div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-xs">{t(`inspectionType.${i.type}`)}</td>
                      <td className="px-2 py-2 text-xs">{formatDate(i.inspectionDate)}</td>
                      <td className="px-2 py-2 text-xs">
                        <Link to={`/real-estate/properties/${i.propertyId}`} className="text-primary">
                          {propById.get(i.propertyId)?.nameEn ?? "—"}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {i.unitId ? (
                          <Link to={`/real-estate/units/${i.unitId}`} className="text-primary">
                            {unitById.get(i.unitId)?.code ?? i.unitId}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <Chip size="sm" variant="flat" color={i.finalized ? "success" : "warning"}>
                          {i.finalized ? t("inspectionsPage.finalized") : t("inspectionsPage.draft")}
                        </Chip>
                      </td>
                      <td className="px-2 py-2 text-end whitespace-nowrap">
                        {canCreate && !i.finalized && (
                          <>
                            <Button
                              size="sm"
                              variant="light"
                              onPress={() => {
                                setEditing(i);
                                setFormOpen(true);
                              }}
                            >
                              {t("buttons.edit")}
                            </Button>
                            <Button size="sm" variant="flat" color="success" isLoading={finalize.isPending} onPress={() => run(finalize.mutateAsync(i.id))}>
                              {t("inspectionsPage.finalize")}
                            </Button>
                          </>
                        )}
                        {canCreate && i.finalized && (
                          <Button size="sm" variant="flat" isLoading={newVersion.isPending} onPress={() => run(newVersion.mutateAsync({ id: i.id, by: actor }))}>
                            {t("inspectionsPage.newVersion")}
                          </Button>
                        )}
                      </td>
                      </tr>
                      {expandedId === i.id && (
                        <tr className="border-b border-default-100 last:border-0">
                        <td colSpan={7} className="px-2 pb-3">
                          <div className="space-y-2 bg-default-50 rounded-lg p-3">
                            {i.conditionNote && <p className="text-xs text-default-600">{i.conditionNote}</p>}
                            {i.checklist.length > 0 && (
                              <ul className="text-xs text-default-600 space-y-0.5">
                                {i.checklist.map((c) => (
                                  <li key={c.id}>
                                    · {c.label} — {t(`checklistResult.${c.result}`)}
                                    {c.note ? ` (${c.note})` : ""}
                                  </li>
                                ))}
                              </ul>
                            )}
                            <Divider />
                            <p className="text-xs font-semibold uppercase tracking-wide text-default-500">{t("inspectionsPage.issues")}</p>
                            {i.issues.length === 0 ? (
                              <p className="text-xs text-default-400">{t("misc.noData")}</p>
                            ) : (
                              i.issues.map((issue) => (
                                <div key={issue.id} className="flex items-center gap-2 text-xs">
                                  <span className="flex-1">{issue.description}{issue.estimatedCost != null ? ` · ${issue.estimatedCost}` : ""}</span>
                                  {issue.workOrderId ? (
                                    <Chip size="sm" variant="flat" color="primary">
                                      {t("inspectionsPage.workOrderLinked")}
                                    </Chip>
                                  ) : (
                                    canCreate && (
                                      <Button
                                        size="sm"
                                        variant="flat"
                                        color="warning"
                                        isLoading={raiseWo.isPending}
                                        onPress={() =>
                                          run(
                                            raiseWo.mutateAsync({ inspectionId: i.id, issueId: issue.id, requestedBy: actor })
                                          )
                                        }
                                      >
                                        {t("inspectionsPage.raiseWorkOrder")}
                                      </Button>
                                    )
                                  )}
                                </div>
                              ))
                            )}
                            {i.handedItems.length > 0 && (
                              <>
                                <Divider />
                                <p className="text-xs text-default-500">
                                  {t("inspectionsPage.handedItems")}:{" "}
                                  {i.handedItems.map((h) => `${h.label} ×${h.quantity}`).join(" · ")}
                                </p>
                              </>
                            )}
                          </div>
                        </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <InspectionFormModal
        isOpen={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o);
          if (!o) setEditing(null);
        }}
        inspection={editing}
      />
    </div>
  );
}
