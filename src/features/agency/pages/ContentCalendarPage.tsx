import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
} from "@heroui/react";
import { CalendarDays, Plus, Search } from "lucide-react";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { selectFieldProps } from "@/components/shared/select-field";
import {
  useBriefs,
  useCampaigns,
  useContentItems,
  useDeleteContentMutation,
  useTransitionContentMutation,
} from "../hooks/use-marketing";
import {
  allowedNextContentStatuses,
} from "../lib/deliverable-rules";
import { CONTENT_STATUS_COLORS } from "../lib/ui-maps";
import { ContentFormModal } from "../components/ContentFormModal";
import { ConfirmModal } from "../components/ConfirmModal";
import type { ContentItem, ContentStatus } from "../types/marketing.types";

const CONTENT_STATUSES: ContentStatus[] = ["draft", "approved", "scheduled", "published", "cancelled"];

export function ContentCalendarPage() {
  const { t } = useTranslation("marketing");
  const { can } = useAppPermissions();
  const canManage = can("marketing.manage");
  const canDelete = can("marketing.delete");

  const { data: contentItems = [], isLoading } = useContentItems();
  const { data: campaigns = [] } = useCampaigns();
  const { data: briefs = [] } = useBriefs();
  const transitionContent = useTransitionContentMutation();
  const deleteContent = useDeleteContentMutation();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ContentStatus | "">("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [deleting, setDeleting] = useState<ContentItem | null>(null);
  const [transitioning, setTransitioning] = useState<ContentItem | null>(null);
  const [moveTo, setMoveTo] = useState<ContentStatus | "">("");

  const campaignLabel = (cid: string) => {
    const c = campaigns.find((x) => x.id === cid);
    return c ? `${c.code} — ${c.name}` : t("misc.removedRef");
  };

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return contentItems
      .filter(
        (c) =>
          (!statusFilter || c.status === statusFilter) &&
          (!term ||
            c.title.toLowerCase().includes(term) ||
            campaignLabel(c.campaignId).toLowerCase().includes(term)),
      )
      .sort((a, b) => ((a.scheduledDate ?? "9999") > (b.scheduledDate ?? "9999") ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentItems, search, statusFilter, campaigns]);

  const nextFor = transitioning ? allowedNextContentStatuses(transitioning.status) : [];
  // Scheduling and publishing both require a concrete date on record (the
  // service enforces the same precondition on write).
  const dateBlocked =
    !!transitioning &&
    (moveTo === "scheduled" || moveTo === "published") &&
    !transitioning.scheduledDate;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-primary" />
            {t("content.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("content.subtitle")}</p>
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
            {t("buttons.newContent")}
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          placeholder={t("buttons.search")}
          value={search}
          onValueChange={setSearch}
          startContent={<Search className="w-4 h-4 text-default-400" />}
          className="max-w-sm"
        />
        <Select
          {...selectFieldProps({ compact: true })}
          placeholder={t("filters.allStatuses")}
          selectedKeys={statusFilter ? [statusFilter] : []}
          onSelectionChange={(keys) => setStatusFilter((Array.from(keys)[0] as ContentStatus) ?? "")}
          className="max-w-[180px]"
        >
          {CONTENT_STATUSES.map((s) => (
            <SelectItem key={s} textValue={t(`contentStatus.${s}`)}>
              {t(`contentStatus.${s}`)}
            </SelectItem>
          ))}
        </Select>
      </div>

      <Card className="overflow-hidden">
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.scheduledDate")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.title")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.campaign")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.channel")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.status")}</th>
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
                    {t("content.empty")}
                  </td>
                </tr>
              ) : (
                rows.map((c) => (
                  <tr key={c.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                    <td className="px-4 py-2.5 tabular-nums">{c.scheduledDate || "—"}</td>
                    <td className="px-4 py-2.5 font-medium">{c.title}</td>
                    <td className="px-4 py-2.5 text-default-600">{campaignLabel(c.campaignId)}</td>
                    <td className="px-4 py-2.5 text-xs text-default-500">{t(`channel.${c.channel}`)}</td>
                    <td className="px-4 py-2.5">
                      <Chip size="sm" variant="flat" color={CONTENT_STATUS_COLORS[c.status]}>
                        {t(`contentStatus.${c.status}`)}
                      </Chip>
                      {c.publishedAt && (
                        <span className="ms-2 text-xs text-default-400 tabular-nums">{c.publishedAt.slice(0, 10)}</span>
                      )}
                    </td>
                    {(canManage || canDelete) && (
                      <td className="px-4 py-2.5 whitespace-nowrap text-end">
                        {canManage && (
                          <>
                            <Button
                              size="sm"
                              variant="light"
                              isDisabled={allowedNextContentStatuses(c.status).length === 0}
                              onPress={() => {
                                setTransitioning(c);
                                setMoveTo("");
                              }}
                            >
                              {t("buttons.changeStatus")}
                            </Button>
                            <Button
                              size="sm"
                              variant="light"
                              onPress={() => {
                                setEditing(c);
                                setFormOpen(true);
                              }}
                            >
                              {t("buttons.edit")}
                            </Button>
                          </>
                        )}
                        {canDelete && (
                          <Button size="sm" variant="light" color="danger" onPress={() => setDeleting(c)}>
                            {t("buttons.delete")}
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <ContentFormModal
        isOpen={formOpen}
        onOpenChange={setFormOpen}
        campaigns={campaigns}
        briefs={briefs}
        content={editing}
      />

      <Modal isOpen={!!transitioning} onOpenChange={(o) => !o && setTransitioning(null)} size="sm">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>{t("content.transitionTitle")} — {transitioning?.title}</ModalHeader>
              <ModalBody className="gap-3">
                <Select
                  {...selectFieldProps()}
                  label={t("content.moveTo")}
                  placeholder={t("filters.allStatuses")}
                  selectedKeys={moveTo ? [moveTo] : []}
                  onSelectionChange={(keys) => setMoveTo((Array.from(keys)[0] as ContentStatus) ?? "")}
                >
                  {nextFor.map((s) => (
                    <SelectItem key={s} textValue={t(`contentStatus.${s}`)}>
                      {t(`contentStatus.${s}`)}
                    </SelectItem>
                  ))}
                </Select>
                {(moveTo === "scheduled" || moveTo === "published") && dateBlocked && (
                  <p className="text-xs text-danger">{t("content.scheduleNeedsDate")}</p>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  {t("buttons.cancel")}
                </Button>
                <Button
                  color="primary"
                  isDisabled={!moveTo || dateBlocked}
                  isLoading={transitionContent.isPending}
                  onPress={async () => {
                    if (!transitioning || !moveTo) return;
                    await transitionContent.mutateAsync({ id: transitioning.id, to: moveTo });
                    setTransitioning(null);
                  }}
                >
                  {t("buttons.confirm")}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <ConfirmModal
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("content.title")}
        body={deleting ? `${deleting.title} — ${t("content.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.delete")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={deleteContent.isPending}
        onConfirm={async () => {
          if (deleting) {
            await deleteContent.mutateAsync(deleting.id);
            setDeleting(null);
          }
        }}
      />
    </div>
  );
}
