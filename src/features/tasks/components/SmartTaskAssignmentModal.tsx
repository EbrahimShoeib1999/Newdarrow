import { useState } from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Chip,
  Avatar,
  Spinner,
} from "@heroui/react";
import {
  Sparkles,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  Briefcase,
  Clock,
  Users,
  ShieldCheck,
  UserX,
} from "lucide-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCompany } from "@/features/companies/context/company-context";
import { useEmployeesQuery, useLeaveRequestsQuery } from "@/features/people/hooks/use-people";
import { useAllTasksQuery } from "@/features/tasks/hooks/use-tasks";
import { TaskService } from "@/features/tasks/api/tasks.service";
import { QUERY_KEYS } from "@/lib/constants";
import {
  getSmartTaskRecommendations,
  type SmartMatchResult,
} from "../utils/smart-assignment.utils";
import type { Task } from "../types/task.types";

interface SmartTaskAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  onAssigned?: () => void;
}

export function SmartTaskAssignmentModal({
  isOpen,
  onClose,
  task,
  onAssigned,
}: SmartTaskAssignmentModalProps) {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const [showAllEmployees, setShowAllEmployees] = useState(false);

  const { data: employeesRes, isLoading: isLoadingEmployees } = useEmployeesQuery();
  const { data: allTasksData, isLoading: isLoadingTasks } = useAllTasksQuery();
  const { data: leaveRes } = useLeaveRequestsQuery();

  const employees = employeesRes?.data || [];
  const allTasks = allTasksData?.data || [];
  const leaveRequests = leaveRes?.data || [];

  const assignMutation = useMutation({
    mutationFn: async (assigneeId: string | null) => {
      if (!companyId || !task) throw new Error("بيانات غير مكتملة");
      return TaskService.updateTask(companyId, task.id, { assigneeId });
    },
    onSuccess: (_, assigneeId) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.tasks.list({ all: true, companyId }) });
      if (task) {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.tasks.detail(task.id) });
      }
      toast.success(
        assigneeId ? "تم تعيين الموظف للمهمة بنجاح" : "تم إلغاء تعيين الموظف"
      );
      onAssigned?.();
      onClose();
    },
    onError: (err: any) => {
      toast.error(err.message || "فشل تعيين الموظف");
    },
  });

  if (!task) return null;

  const isLoading = isLoadingEmployees || isLoadingTasks;

  const report = getSmartTaskRecommendations(
    {
      title: task.title,
      department: task.department,
      tags: task.tags,
      description: task.description,
    },
    employees,
    allTasks,
    leaveRequests
  );

  const renderCandidateCard = (match: SmartMatchResult, isRecommended: boolean) => {
    const { employee, score, matchLevel, workload, reasons, warning } = match;
    const isCurrentAssignee =
      task.assigneeId === employee.userId || task.assigneeId === employee.id;
    const isPending = assignMutation.isPending;

    const empName =
      employee.nameAr ||
      employee.name ||
      [employee.firstName, employee.lastName].filter(Boolean).join(" ") ||
      employee.email;

    return (
      <div
        key={employee.id}
        className={`p-4 rounded-2xl border transition-all ${
          isCurrentAssignee
            ? "border-primary bg-primary/5 shadow-sm"
            : isRecommended
            ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/20 hover:border-emerald-300"
            : "border-default-200 bg-default-50/50 hover:bg-default-100/50"
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar
              src={employee.avatarUrl}
              name={empName}
              size="md"
              className="ring-2 ring-primary/20"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-foreground">{empName}</span>
                {isCurrentAssignee && (
                  <Chip size="sm" color="primary" variant="flat" className="h-5 text-[10px] font-bold">
                    المعين حالياً
                  </Chip>
                )}
                {matchLevel === "best" && (
                  <Chip
                    size="sm"
                    color="success"
                    variant="flat"
                    startContent={<Sparkles className="h-3 w-3" />}
                    className="h-5 text-[10px] font-bold"
                  >
                    أفضل تطابق ({score}%)
                  </Chip>
                )}
                {matchLevel === "good" && (
                  <Chip size="sm" color="secondary" variant="flat" className="h-5 text-[10px] font-bold">
                    مطابق للقسم ({score}%)
                  </Chip>
                )}
              </div>
              <p className="text-xs text-default-500 flex items-center gap-2 mt-0.5">
                <span className="font-medium">{employee.jobTitle || "موظف"}</span>
                <span>•</span>
                <span className="text-default-400">{employee.department || "عام"}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Chip
              size="sm"
              variant="flat"
              color={workload > 5 ? "danger" : workload > 2 ? "warning" : "default"}
              className="text-[11px]"
            >
              {workload} مهام نشطة
            </Chip>
            {isCurrentAssignee ? (
              <Button
                size="sm"
                color="danger"
                variant="light"
                startContent={<UserX className="h-4 w-4" />}
                isDisabled={isPending}
                onPress={() => assignMutation.mutate(null)}
              >
                إلغاء التعيين
              </Button>
            ) : (
              <Button
                size="sm"
                color={isRecommended ? "success" : "primary"}
                variant={isRecommended ? "solid" : "flat"}
                startContent={<UserCheck className="h-4 w-4" />}
                isDisabled={isPending || match.isOnLeave}
                onPress={() => assignMutation.mutate(employee.userId || employee.id)}
              >
                تعيين
              </Button>
            )}
          </div>
        </div>

        {/* Reasons and Warnings */}
        {(reasons.length > 0 || warning) && (
          <div className="mt-2.5 pt-2 border-t border-default-100/80 flex flex-wrap items-center gap-2 text-xs">
            {reasons.map((r, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md"
              >
                <CheckCircle2 className="h-3 w-3 shrink-0" />
                {r}
              </span>
            ))}
            {warning && (
              <span className="inline-flex items-center gap-1 text-[11px] text-danger-600 bg-danger-500/10 px-2 py-0.5 rounded-md">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {warning}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-primary font-bold">
            <Sparkles className="h-5 w-5" />
            <span>التعيين الذكي للمهام حسب التخصص والجاهزية</span>
          </div>
          <p className="text-xs text-default-500 font-normal">
            مطابقة المهمة مع أقسام الموظفين، مهاراتهم المعتمدة، وأعباء عملهم الحالية
          </p>
        </ModalHeader>

        <ModalBody className="space-y-4">
          {/* Task Summary Banner */}
          <div className="p-4 rounded-2xl bg-default-100/70 border border-default-200 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-sm text-foreground">{task.title}</h4>
              <Chip size="sm" variant="flat" color="primary" className="font-bold">
                {task.department || "غير محدد القسم"}
              </Chip>
            </div>
            {task.description && (
              <p className="text-xs text-default-500 line-clamp-2">{task.description}</p>
            )}
            <div className="flex flex-wrap items-center gap-3 text-xs text-default-500 pt-1">
              {task.estimatedHours ? (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-default-400" />
                  {task.estimatedHours} ساعة مقدرة
                </span>
              ) : null}
              {task.priority && (
                <span className="flex items-center gap-1">
                  <Briefcase className="h-3.5 w-3.5 text-default-400" />
                  أولوية: {task.priority}
                </span>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3">
              <Spinner size="lg" color="primary" />
              <p className="text-sm text-default-400">جاري تحليل تخصصات الموظفين وأعباء العمل...</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Recommendation Explanation */}
              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-start gap-2.5 text-xs text-blue-700 dark:text-blue-300">
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">{report.explanation}</p>
                  <p className="text-[11px] text-default-500 mt-0.5">
                    إجمالي الموظفين النشطين في الشركة: {report.totalActiveEmployees} موظف
                  </p>
                </div>
              </div>

              {/* Recommended Candidates */}
              {report.recommendedCandidates.length > 0 && (
                <div className="space-y-2.5">
                  <h5 className="font-bold text-xs text-default-700 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
                    المرشحون الموصى بهم ({report.recommendedCandidates.length})
                  </h5>
                  <div className="space-y-2">
                    {report.recommendedCandidates.map((m) => renderCandidateCard(m, true))}
                  </div>
                </div>
              )}

              {/* Other Employees Section (Expandable/Override) */}
              <div className="pt-2">
                <div className="flex items-center justify-between pb-2">
                  <h5 className="font-bold text-xs text-default-500 flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    باقي موظفي الشركة ({report.otherCandidates.length})
                  </h5>
                  <Button
                    size="sm"
                    variant="light"
                    className="text-xs text-primary font-bold h-7"
                    onPress={() => setShowAllEmployees(!showAllEmployees)}
                  >
                    {showAllEmployees ? "إخفاء باقي الموظفين" : "عرض باقي الموظفين للتعيين اليدوي"}
                  </Button>
                </div>

                {showAllEmployees && (
                  <div className="space-y-2 mt-2">
                    {report.otherCandidates.length === 0 ? (
                      <p className="text-xs text-default-400 p-3 text-center">لا يوجد موظفون آخرون.</p>
                    ) : (
                      report.otherCandidates.map((m) => renderCandidateCard(m, false))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            إغلاق
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
