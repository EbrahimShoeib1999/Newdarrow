import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Input } from "@heroui/react";
import { FileText, Paperclip, Plus, Search } from "lucide-react";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import {
  useBriefs,
  useCampaigns,
  useDeleteBriefMutation,
  useDeliverables,
} from "../hooks/use-marketing";
import { BriefFormModal } from "../components/BriefFormModal";
import { ConfirmModal } from "../components/ConfirmModal";
import { formatDate } from "@/lib/utils";
import type { CreativeBrief } from "../types/marketing.types";

export function BriefsPage() {
  const { t } = useTranslation("marketing");
  const { can } = useAppPermissions();
  const canManage = can("marketing.manage");
  const canDelete = can("marketing.delete");

  const { data: briefs = [], isLoading } = useBriefs();
  const { data: campaigns = [] } = useCampaigns();
  const { data: deliverables = [] } = useDeliverables();
  const deleteBrief = useDeleteBriefMutation();

  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CreativeBrief | null>(null);
  const [deleting, setDeleting] = useState<CreativeBrief | null>(null);

  const campaignLabel = (cid: string) => {
    const c = campaigns.find((x) => x.id === cid);
    return c ? `${c.code} — ${c.name}` : t("misc.removedRef");
  };

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return briefs.filter(
      (b) =>
        !term ||
        b.title.toLowerCase().includes(term) ||
        campaignLabel(b.campaignId).toLowerCase().includes(term),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefs, search, campaigns]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary" />
            {t("briefs.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("briefs.subtitle")}</p>
        </div>
        {canManage && campaigns.length > 0 && (
          <Button
            color="primary"
            startContent={<Plus className="w-4 h-4" />}
            onPress={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {t("buttons.newBrief")}
          </Button>
        )}
      </div>

      <Input
        placeholder={t("buttons.search")}
        value={search}
        onValueChange={setSearch}
        startContent={<Search className="w-4 h-4 text-default-400" />}
        className="max-w-sm"
      />

      <Card className="overflow-hidden">
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.title")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.campaign")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.deliverable")}</th>
                <th className="px-4 py-2.5 text-start">{t("briefs.attachments")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.createdAt")}</th>
                {(canManage || canDelete) && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-default-400">…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-default-400">
                    {t("briefs.empty")}
                  </td>
                </tr>
              ) : (
                rows.map((b) => {
                  const linkedDeliverable = deliverables.find((d) => d.id === b.deliverableId);
                  return (
                    <tr key={b.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                      <td className="px-4 py-2.5 font-medium">{b.title}</td>
                      <td className="px-4 py-2.5 text-default-600">{campaignLabel(b.campaignId)}</td>
                      <td className="px-4 py-2.5 text-default-500">{linkedDeliverable?.title ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        {b.attachments.length === 0 ? (
                          <span className="text-default-400 text-xs">{t("misc.none")}</span>
                        ) : (
                          <span className="flex flex-wrap gap-2">
                            {b.attachments.map((a, i) => (
                              <a
                                key={`${a.url}-${i}`}
                                href={a.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              >
                                <Paperclip className="w-3 h-3" />
                                {a.name}
                              </a>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-default-500">{formatDate(b.createdAt)}</td>
                      {(canManage || canDelete) && (
                        <td className="px-4 py-2.5 whitespace-nowrap text-end">
                          {canManage && (
                            <Button
                              size="sm"
                              variant="light"
                              onPress={() => {
                                setEditing(b);
                                setFormOpen(true);
                              }}
                            >
                              {t("buttons.edit")}
                            </Button>
                          )}
                          {canDelete && (
                            <Button size="sm" variant="light" color="danger" onPress={() => setDeleting(b)}>
                              {t("buttons.delete")}
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <BriefFormModal
        isOpen={formOpen}
        onOpenChange={setFormOpen}
        campaigns={campaigns}
        deliverables={deliverables}
        brief={editing}
      />

      <ConfirmModal
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("briefs.title")}
        body={deleting ? `${deleting.title} — ${t("briefs.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.delete")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={deleteBrief.isPending}
        onConfirm={async () => {
          if (deleting) {
            await deleteBrief.mutateAsync(deleting.id);
            setDeleting(null);
          }
        }}
      />
    </div>
  );
}
