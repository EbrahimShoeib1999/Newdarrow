import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { TaskService } from "@/features/tasks/api/tasks.service";
import { NotificationsService } from "@/features/notifications/api/notifications.service";
import type { UserRole } from "@/features/auth/types/auth.types";

const SUPPORT_LINK = "/tasks/work";

/**
 * Raise a support request as a tracked TASK (Phase 8E: reuse existing entities —
 * no parallel ticketing subsystem). The submission is an explicit user action, so
 * creating a task here is authorized; it never mutates any financial or privileged
 * record. After creation, the tenant's admins/managers are notified so the request
 * flows: request → assignment → status updates → resolution.
 */
export async function raiseSupportTicket(input: {
  companyId: string;
  actorId: string;
  actorName: string;
  subject: string;
  description?: string;
  /** Safe page reference only (path, never ids/params) — optional. */
  pageRef?: string;
}): Promise<{ taskId: string; notified: number }> {
  const subject = input.subject.trim();
  if (!subject) throw new Error("support_subject_required");

  const { data: task } = await TaskService.createTask(
    input.companyId,
    {
      title: `[Support] ${subject}`.slice(0, 200),
      description: [
        input.description?.trim(),
        input.pageRef ? `Page: ${input.pageRef}` : "",
        `Raised by: ${input.actorName || input.actorId}`,
      ]
        .filter(Boolean)
        .join("\n"),
      priority: "medium",
      assigneeId: null, // support queue — a manager assigns it
      tags: ["support", "assistant"],
    },
    { userId: input.actorId, userName: input.actorName }
  );

  // Notify privileged roles (admins/managers) — excluding the requester.
  const usersSnap = await getDocs(
    query(collection(db, "users"), where("companyId", "==", input.companyId))
  );
  const recipients = usersSnap.docs
    .map((s) => ({ id: s.id, role: s.data().role as UserRole | undefined }))
    .filter(
      (u) =>
        u.id !== input.actorId &&
        (u.role === "super_admin" || u.role === "admin" || u.role === "manager")
    );

  await Promise.allSettled(
    recipients.map((u) =>
      NotificationsService.createNotification(input.companyId, {
        userId: u.id,
        type: "general",
        title: `${input.actorName || "A user"} opened a support request`,
        message: subject,
        link: SUPPORT_LINK,
      })
    )
  );

  return { taskId: task.id, notified: recipients.length };
}
