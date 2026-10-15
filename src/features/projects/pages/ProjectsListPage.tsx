import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  Input,
  Spinner,
  Tooltip,
} from "@heroui/react";
import {
  CalendarDays,
  Edit2,
  Filter,
  FolderKanban,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import {
  useDeleteProjectMutation,
  useProjects,
} from "../hooks/use-projects";
import { ProjectFormModal } from "../components/ProjectFormModal";
import type { Project, ProjectStatus } from "../types/projects.types";

type StatusFilter = "all" | ProjectStatus;

const STATUS_STYLES: Record<ProjectStatus, string> = {
  active: "bg-success/10 text-success",
  completed: "bg-primary/10 text-primary",
  on_hold: "bg-warning/10 text-warning",
  cancelled: "bg-danger/10 text-danger",
};

export function ProjectsListPage({
  scope = "all",
}: {
  scope?: "all" | "mine" | "completed";
}) {
  const { t } = useTranslation("projects");
  const userId = useAuthStore((s) => s.user?.id);
  const { can } = useAppPermissions();
  const canManage = can("projects.manage");
  const canDelete = can("projects.delete");
  const { data: projects = [], isLoading } = useProjects();
  const deleteProject = useDeleteProjectMutation();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    scope === "completed" ? "completed" : "all"
  );
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (scope === "mine" && !(userId && p.members?.includes(userId))) return false;
      if (scope === "completed" && p.status !== "completed") return false;
      if (scope !== "completed" && statusFilter !== "all" && p.status !== statusFilter)
        return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [projects, search, statusFilter, scope, userId]);

  const handleCreate = () => {
    setEditingProject(null);
    setIsModalOpen(true);
  };

  const handleEdit = (project: Project) => {
    setEditingProject(project);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteProject.mutateAsync(id);
    } finally {
      setDeletingId(null);
    }
  };

  const statusChips: { key: StatusFilter; label: string }[] = [
    { key: "all", label: t("filters.all") },
    { key: "active", label: t("filters.active") },
    { key: "on_hold", label: t("filters.on_hold") },
    { key: "completed", label: t("filters.completed") },
    { key: "cancelled", label: t("filters.cancelled") },
  ];

  const heading =
    scope === "mine"
      ? t("nav.my_projects")
      : scope === "completed"
        ? t("nav.completed_projects")
        : t("title");

  const emptyMessage =
    scope === "mine"
      ? t("emptyMine")
      : scope === "completed"
        ? t("emptyCompleted")
        : t("empty");

  return (
    <div className="pb-20 animate-in fade-in duration-300">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">{heading}</h1>
          <p className="text-sm text-default-500">{t("subtitle")}</p>
        </div>
        {canManage && (
          <Button
            color="primary"
            className="font-semibold"
            startContent={<Plus className="h-4 w-4" />}
            onPress={handleCreate}
          >
            {t("add")}
          </Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          size="sm"
          variant="flat"
          className="min-w-[220px] max-w-md flex-1"
          placeholder={t("search")}
          value={search}
          onValueChange={setSearch}
          startContent={<Search className="h-4 w-4 text-default-400" />}
          classNames={{
            inputWrapper: "bg-content1 border border-default-200 shadow-none",
          }}
        />
        {scope !== "completed" && (
          <Dropdown>
            <DropdownTrigger>
              <Button
                size="sm"
                variant="flat"
                startContent={<Filter className="h-4 w-4" />}
              >
                {statusFilter === "all"
                  ? t("filters.all")
                  : t(`status.${statusFilter}`)}
              </Button>
            </DropdownTrigger>
            <DropdownMenu
              aria-label={t("columns.status")}
              selectedKeys={new Set([statusFilter])}
              selectionMode="single"
              onSelectionChange={(keys) => {
                const key = Array.from(keys)[0] as StatusFilter;
                if (key) setStatusFilter(key);
              }}
            >
              {statusChips.map(({ key, label }) => (
                <DropdownItem key={key}>{label}</DropdownItem>
              ))}
            </DropdownMenu>
          </Dropdown>
        )}
        <span className="ms-auto text-xs font-semibold text-default-400">
          {t("memberCount", { count: filtered.length })}
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-24">
          <Spinner color="primary" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border border-default-100">
          <CardBody className="flex flex-col items-center gap-3 py-16 text-center">
            <FolderKanban className="h-10 w-10 text-default-300" />
            <p className="text-default-500">{emptyMessage}</p>
            {canManage && scope === "all" && (
              <Button
                color="primary"
                variant="flat"
                startContent={<Plus className="h-4 w-4" />}
                onPress={handleCreate}
              >
                {t("add")}
              </Button>
            )}
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project) => (
            <Card
              key={project.id}
              className="border border-default-100 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
            >
              <CardBody className="gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <FolderKanban className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate font-bold text-default-900">
                        {project.name}
                      </h3>
                      <Chip
                        size="sm"
                        variant="flat"
                        className={cn(
                          "mt-1 border-none font-bold text-[11px]",
                          STATUS_STYLES[project.status]
                        )}
                      >
                        {t(`status.${project.status}`)}
                      </Chip>
                    </div>
                  </div>
                  {(canManage || canDelete) && (
                    <div className="flex shrink-0 gap-0.5">
                      {canManage && (
                        <Tooltip content={t("actions.edit")}>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            aria-label={t("actions.edit")}
                            onPress={() => handleEdit(project)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        </Tooltip>
                      )}
                      {canDelete && (
                        <Tooltip content={t("actions.delete")}>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            color="danger"
                            aria-label={t("actions.delete")}
                            isLoading={deletingId === project.id}
                            onPress={() => handleDelete(project.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </Tooltip>
                      )}
                    </div>
                  )}
                </div>

                {project.description && (
                  <p className="line-clamp-2 text-sm text-default-500">
                    {project.description}
                  </p>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-3 text-xs text-default-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    {t("memberCount", { count: project.members?.length ?? 0 })}
                  </span>
                  {(project.startDate || project.endDate) && (
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {project.startDate || "—"} → {project.endDate || "—"}
                    </span>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <ProjectFormModal
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        project={editingProject}
      />
    </div>
  );
}
