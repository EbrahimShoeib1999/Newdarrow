export type ClassificationColor =
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "danger"
  | "default";

export interface ContactClassificationItem {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
  color: ClassificationColor;
  emoji?: string;
  isCustom?: boolean;
  isDefault?: boolean;
  isActive?: boolean;
  isArchived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CreateClassificationDTO = Omit<
  ContactClassificationItem,
  "id" | "createdAt" | "updatedAt"
>;

export type UpdateClassificationDTO = Partial<CreateClassificationDTO>;
