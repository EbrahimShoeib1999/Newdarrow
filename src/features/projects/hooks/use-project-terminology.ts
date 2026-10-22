import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/features/companies/context/company-context";
import { ProjectSettingsService } from "../api/project-settings.service";
import {
  DEFAULT_TERMINOLOGY,
  type ProjectTerminology,
} from "../schemas/project-settings.schema";

const QUERY_KEY = ["project-settings"] as const;

export function useProjectSettings() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, companyId],
    queryFn: async () => {
      const res = await ProjectSettingsService.get(companyId!);
      return res.data;
    },
    enabled: !!companyId,
    staleTime: 60 * 1000,
  });
}

export interface ProjectTerms {
  singular: string;
  plural: string;
  /** Sentence/label-capitalized singular (no-op for Arabic, which has no case). */
  singularCap: string;
  /** True when the tenant configured custom display names. */
  isCustom: boolean;
  terms: { singular: ProjectTerminology["singular"]; plural: ProjectTerminology["plural"] };
}

function capitalize(value: string, lang: "ar" | "en"): string {
  if (lang === "ar" || !value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Resolve the active display terminology for the current language. */
export function useProjectTerms(): ProjectTerms {
  const { i18n } = useTranslation();
  const { data: settings } = useProjectSettings();
  const lang = i18n.language?.startsWith("ar") ? "ar" : "en";
  const configured = settings?.terminology;

  return useMemo(
    () => {
      const singular = configured?.singular[lang] || DEFAULT_TERMINOLOGY.singular[lang];
      const plural = configured?.plural[lang] || DEFAULT_TERMINOLOGY.plural[lang];
      return {
        singular,
        plural,
        singularCap: capitalize(singular, lang),
        isCustom: !!configured,
        terms: {
          singular: configured?.singular ?? DEFAULT_TERMINOLOGY.singular,
          plural: configured?.plural ?? DEFAULT_TERMINOLOGY.plural,
        },
      };
    },
    [configured, lang]
  );
}

/**
 * Translation wrapper for the projects namespace that injects the configured
 * terminology into every label ({{singular}} / {{plural}} interpolation).
 * All module screens must use this instead of the raw useTranslation("projects")
 * so renaming never applies partially.
 */
export function useProjectT() {
  const { t, ...rest } = useTranslation("projects");
  const terms = useProjectTerms();

  const tp = useMemo(() => {
    // Loosely-typed view of the i18next t() so interpolated params pass cleanly
    // and the result is always a renderable string.
    const baseT = t as unknown as (key: string, opts?: Record<string, unknown>) => string;
    const wrapped = (key: string, options?: Record<string, unknown>) =>
      baseT(key, {
        singular: terms.singular,
        plural: terms.plural,
        singularCap: terms.singularCap,
        ...options,
      });
    return Object.assign(wrapped, { t });
  }, [t, terms]);

  return { t: tp, rawT: t, terms, ...rest };
}

export function useUpdateProjectTerminologyMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();

  return useMutation({
    mutationFn: async (terminology: ProjectTerminology | null) => {
      const res = await ProjectSettingsService.updateTerminology(companyId!, terminology);
      return res.data;
    },
    onSuccess: (saved) => {
      if (companyId) queryClient.setQueryData([...QUERY_KEY, companyId], saved);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
