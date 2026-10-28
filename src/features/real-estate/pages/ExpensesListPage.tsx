import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Input } from "@heroui/react";
import { ReceiptText, Search, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useProperties } from "../hooks/use-real-estate";
import { useDeleteExpenseMutation, useExpenses, useUpdateExpenseMutation } from "../hooks/use-real-estate-ops";
import { useRemActor } from "../hooks/use-real-estate";
import { RemSelect } from "../components/RemSelect";
import { ExpenseFormModal } from "../components/ExpenseFormModal";
import { ConfirmModal } from "../components/ConfirmModal";
import { remErrorText } from "../lib/ui-maps";
import type { PropertyExpense } from "../types/real-estate.types";

const APPROVAL_COLORS: Record<PropertyExpense["approvalStatus"], "default" | "success" | "danger"> = {
  pending: "default",
  approved: "success",
  rejected: "danger",
};

/**
 * Property expenses: a REM-side view over shared billing records (amount
 * snapshot + reference). Approval decisions follow the same
 * `real_estate.approve` gate the service enforces.
 */
export function ExpensesListPage() {
  const { t } = useTranslation("real_estate");
  const { can } = useAppPermissions();
  const canCreate = can("real_estate.create");
  const canApprove = can("real_estate.approve");
  const actor = useRemActor();

  const { data: expenses = [], isLoading } = useExpenses();
  const { data: properties = [] } = useProperties();
  const update = useUpdateExpenseMutation();
  const remove = useDeleteExpenseMutation();

  const [query, setQuery] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PropertyExpense | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PropertyExpense | null>(null);

  const propById = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties]);

  const categories = useMemo(() => [...new Set(expenses.map((e) => e.category))], [expenses]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return expenses
      .filter((e) => {
        if (propertyFilter && e.propertyId !== propertyFilter) return false;
        if (categoryFilter && e.category !== categoryFilter) return false;
        if (!q) return true;
        return `${e.description} ${e.vendorNameSnapshot ?? ""}`.toLowerCase().includes(q);
      })
      .sort((a, b) => (a.expenseDate < b.expenseDate ? 1 : -1));
  }, [expenses, query, propertyFilter, categoryFilter]);

  // Period total from the filtered rows (single currency noted per row).
  const totalByCurrency = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of rows) map.set(e.currency, (map.get(e.currency) ?? 0) + e.amount);
    return [...map.entries()];
  }, [rows]);

  const decide = (e: PropertyExpense, status: "approved" | "rejected") =>
    update
      .mutateAsync({ id: e.id, dto: { approvalStatus: status }, by: actor, canApprove })
      .catch((err) => toast.error(remErrorText(t, err)));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <Wallet className="w-6 h-6 text-primary" />
            {t("expensesPage.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("expensesPage.subtitle")}</p>
        </div>
        {canCreate && (
          <Button
            color="primary"
            startContent={<ReceiptText className="w-4 h-4" />}
            onPress={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {t("expensesPage.formNew")}
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          size="sm"
          className="sm:max-w-xs"
          startContent={<Search className="w-4 h-4 text-default-400" />}
          placeholder={t("expensesPage.searchPlaceholder")}
          value={query}
          onValueChange={setQuery}
        />
        <RemSelect
          label={t("fields.property")}
          value={propertyFilter}
          onChange={setPropertyFilter}
          placeholderKey={t("misc.all")}
          options={properties.map((p) => ({ id: p.id, label: p.nameEn }))}
        />
        <RemSelect
          label={t("fields.category")}
          value={categoryFilter}
          onChange={setCategoryFilter}
          placeholderKey={t("misc.all")}
          options={categories.map((c) => ({ id: c, label: t(`expenseCategory.${c}`) }))}
        />
      </div>

      {totalByCurrency.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {totalByCurrency.map(([currency, sum]) => (
            <Chip key={currency} size="sm" variant="flat">
              {t("misc.total")}: {formatCurrency(sum, currency)}
            </Chip>
          ))}
        </div>
      )}

      <Card>
        <CardBody>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-default-400 py-4">{t("expensesPage.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-default-500 border-b border-default-200">
                    <th className="px-2 py-2 text-start">{t("fields.date")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.description")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.property")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.category")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.vendor")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.amount")}</th>
                    <th className="px-2 py-2 text-start">{t("expensesPage.approvalStatus")}</th>
                    <th className="px-2 py-2 text-end">{t("fields.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} className="border-b border-default-100 last:border-0">
                      <td className="px-2 py-2 text-xs">{formatDate(e.expenseDate)}</td>
                      <td className="px-2 py-2 text-sm">{e.description}</td>
                      <td className="px-2 py-2 text-xs">{propById.get(e.propertyId)?.nameEn ?? e.propertyId}</td>
                      <td className="px-2 py-2 text-xs">{t(`expenseCategory.${e.category}`)}</td>
                      <td className="px-2 py-2 text-xs">{e.vendorNameSnapshot ?? "—"}</td>
                      <td className="px-2 py-2 tabular-nums">{formatCurrency(e.amount, e.currency)}</td>
                      <td className="px-2 py-2">
                        <Chip size="sm" variant="flat" color={APPROVAL_COLORS[e.approvalStatus]}>
                          {t(`approvalStatus.${e.approvalStatus}`)}
                        </Chip>
                      </td>
                      <td className="px-2 py-2 text-end whitespace-nowrap">
                        {canApprove && e.approvalStatus === "pending" && (
                          <>
                            <Button size="sm" variant="flat" color="success" isLoading={update.isPending} onPress={() => decide(e, "approved")}>
                              {t("buttons.approve")}
                            </Button>
                            <Button size="sm" variant="light" color="danger" className="ms-1" isLoading={update.isPending} onPress={() => decide(e, "rejected")}>
                              {t("buttons.reject")}
                            </Button>
                          </>
                        )}
                        {canCreate && (
                          <Button
                            size="sm"
                            variant="light"
                            className="ms-1"
                            onPress={() => {
                              setEditing(e);
                              setFormOpen(true);
                            }}
                          >
                            {t("buttons.edit")}
                          </Button>
                        )}
                        {canCreate && (
                          <Button size="sm" variant="light" color="danger" className="ms-1" onPress={() => setDeleteTarget(e)}>
                            {t("buttons.delete")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <ExpenseFormModal
        isOpen={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o);
          if (!o) setEditing(null);
        }}
        expense={editing}
        canApprove={canApprove}
      />

      <ConfirmModal
        isOpen={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t("expensesPage.deleteConfirm")}
        body={deleteTarget?.description ?? ""}
        confirmLabel={t("buttons.delete")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={remove.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await remove.mutateAsync(deleteTarget.id);
            setDeleteTarget(null);
          } catch (err) {
            toast.error(remErrorText(t, err));
          }
        }}
      />
    </div>
  );
}
