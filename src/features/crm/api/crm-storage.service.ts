import { withLogging } from "@/lib/service-utils";
import { AttachmentsService } from "./attachments.service";
import type { CrmAttachment } from "../types/attachments.types";

const SERVICE_NAME = "CrmStorageService";

export const MAX_CRM_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

const ALLOWED_EXTS = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "pdf",
  "xls",
  "xlsx",
  "doc",
  "docx",
];

export function isAllowedCrmFile(file: File): boolean {
  if (ALLOWED_MIME.includes(file.type)) return true;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ALLOWED_EXTS.includes(ext ?? "");
}

export function validateCrmFileForUpload(file: File): { valid: boolean; error?: string } {
  if (file.size > MAX_CRM_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: "حجم الملف يتجاوز الحد الأقصى المسموح به (10 ميجابايت)",
    };
  }
  if (!isAllowedCrmFile(file)) {
    return {
      valid: false,
      error: "صيغة الملف غير مدعومة. الصيغ المسموحة: PDF, PNG, JPG, GIF, WEBP, XLSX, XLS, DOCX, DOC",
    };
  }
  return { valid: true };
}

export async function uploadCrmAttachment(
  _companyId: string,
  entityType: string,
  entityId: string,
  file: File
): Promise<CrmAttachment> {
  return withLogging(SERVICE_NAME, "uploadCrmAttachment", async () => {
    const validation = validateCrmFileForUpload(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    const res = await AttachmentsService.uploadAttachment(entityType, entityId, file);
    if (!res.data) {
      throw new Error("Failed to upload attachment");
    }
    return res.data;
  });
}
