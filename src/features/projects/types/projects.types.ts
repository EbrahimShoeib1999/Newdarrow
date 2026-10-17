export type ProjectStatus = "active" | "completed" | "on_hold" | "cancelled" | "archived";
export type ProjectPriority = "low" | "medium" | "high" | "urgent";

export interface CustomFieldDefinition {
  id: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "boolean";
  value: string;
}

export interface Project {
  id: string;
  name: string;
  slug?: string;
  description: string;
  status: ProjectStatus;
  priority?: ProjectPriority;
  category?: string;
  tags?: string[];
  customFields?: Record<string, string>;
  members: string[]; // array of user IDs
  createdBy: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateProjectDTO = Omit<Project, "id" | "createdAt" | "updatedAt">;
export type UpdateProjectDTO = Partial<CreateProjectDTO>;
