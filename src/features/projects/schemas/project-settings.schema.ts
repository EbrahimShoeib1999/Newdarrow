import { z } from "zod";

/**
 * Tenant-scoped display terminology for the Projects module.
 * Display names only — collection names, model ids, API contracts,
 * permissions and route ids are intentionally unaffected.
 */
const termLabel = z
  .string()
  .trim()
  .min(1, "Required")
  .max(40, "Too long")
  .regex(
    /^[\p{L}\p{M}\p{N} ,'&\-\u0600-\u06FF\/]+$/u,
    "Letters, numbers, spaces and hyphens only"
  );

export const projectTerminologySchema = z.object({
  singular: z.object({ en: termLabel, ar: termLabel }),
  plural: z.object({ en: termLabel, ar: termLabel }),
});

export const projectSettingsSchema = z.object({
  /** Absent terminology means "use the built-in translations". */
  terminology: projectTerminologySchema.optional(),
});

export type ProjectTerminology = z.infer<typeof projectTerminologySchema>;
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

/** Built-in fallbacks matching the default translation wording. */
export const DEFAULT_TERMINOLOGY: ProjectTerminology = {
  singular: { en: "Project", ar: "مشروع" },
  plural: { en: "Projects", ar: "المشاريع" },
};
