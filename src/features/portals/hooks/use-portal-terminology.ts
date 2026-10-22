import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useProjectTerms } from "@/features/projects/hooks/use-project-terminology";

/**
 * Terminology-aware view of the shared (common) translation namespace.
 *
 * The All Applications launcher, portal sidebar headers and portal guard all
 * render the projects entity through the `portals.projects.*` keys. Wrapping
 * `useTranslation()` here injects the tenant's configured singular/plural into
 * every call, so those app-level labels honor the same display terminology as
 * the Projects module itself — without touching route ids, collection names or
 * the underlying translation keys.
 *
 * The injected params are harmless for keys that do not reference them, and the
 * built-in defaults reproduce the existing wording exactly when no custom
 * terminology is configured.
 */
export function usePortalT() {
  const { t, ...rest } = useTranslation();
  const terms = useProjectTerms();

  const tp = useMemo(() => {
    // Loosely-typed view of i18next t() so interpolated params pass cleanly.
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
