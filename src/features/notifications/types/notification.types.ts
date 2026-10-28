export type NotificationType =
  | "task_created"
  | "task_updated"
  | "task_assigned"
  | "attendance_started"
  | "attendance_resumed"
  | "attendance_completed"
  | "chat_mention"
  | "chat_message"
  | "document_approval"
  | "reminder"
  | "general";

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  isRead: boolean;
  link?: string;
  createdAt: string;
  /**
   * Machine keys written by activity generators (e.g. REAL_ESTATE reminders):
   * fully-namespaced i18next keys + interpolation params. The raw title and
   * message above remain the language-agnostic fallback.
   */
  titleKey?: string;
  bodyKey?: string;
  params?: Record<string, string>;
}

export interface CreateNotificationDTO {
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  link?: string;
}
