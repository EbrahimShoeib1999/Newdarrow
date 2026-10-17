import type { CreateContractDTO, UpdateContractDTO } from "../types/contract.types";
import { deepStripUndefined } from "./firestore-mappers";

/**
 * Recursively inspects an object or array to find all paths where the value is `undefined`.
 * Returns an array of field paths (e.g. ["form.clauses[0].body", "contactId"]).
 * Never returns or logs sensitive content, personal data, or credentials.
 */
export function findUndefinedPaths(obj: unknown, prefix = ""): string[] {
  const paths: string[] = [];

  if (obj === undefined) {
    paths.push(prefix || "(root)");
    return paths;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      const currentPath = `${prefix}[${index}]`;
      if (item === undefined) {
        paths.push(currentPath);
      } else {
        paths.push(...findUndefinedPaths(item, currentPath));
      }
    });
    return paths;
  }

  if (obj !== null && typeof obj === "object") {
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      // Non-plain object (e.g. Timestamp, FieldValue), skip internal traversal
      return paths;
    }

    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      const currentPath = prefix ? `${prefix}.${key}` : key;
      if (val === undefined) {
        paths.push(currentPath);
      } else {
        paths.push(...findUndefinedPaths(val, currentPath));
      }
    }
  }

  return paths;
}

/**
 * Validates genuinely required contract fields before attempting Firestore writes.
 * Throws an informative Error if a required field is missing.
 */
export function validateContractPayload(
  data: Partial<CreateContractDTO> | Partial<UpdateContractDTO>
): void {
  if (!data) {
    throw new Error("بيانات العقد غير صالحة");
  }

  if ("title" in data && (typeof data.title !== "string" || !data.title.trim())) {
    throw new Error("عنوان العقد مطلوب");
  }

  if (data.form) {
    if (!data.form.title || !data.form.title.trim()) {
      throw new Error("عنوان نموذج العقد مطلوب");
    }
    if (!data.form.client?.name || !data.form.client.name.trim()) {
      throw new Error("اسم العميل مطلوب لحفظ العقد");
    }
    if (!data.form.contractNumber || !data.form.contractNumber.trim()) {
      throw new Error("رقم العقد مطلوب");
    }
    if (!data.form.provider?.name || !data.form.provider.name.trim()) {
      throw new Error("بيانات الطرف الأول (مقدم الخدمة) مطلوبة");
    }
  }
}

/**
 * Normalizes contract data at the service boundary:
 * 1. Diagnostically detects any undefined paths and logs paths only (no sensitive data).
 * 2. Recursively strips undefined optional values while preserving valid false, 0, "", null, and empty arrays.
 */
export function normalizeContractPayload<T extends Record<string, unknown>>(payload: T): T {
  const undefinedPaths = findUndefinedPaths(payload);
  if (undefinedPaths.length > 0) {
    console.warn(
      `[ContractsService:diagnostic] Sanitizing ${undefinedPaths.length} undefined field path(s) before Firestore write:`,
      undefinedPaths
    );
  }

  return deepStripUndefined(payload);
}
