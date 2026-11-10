import {
  CANONICAL_COMPANY_ID,
  CANONICAL_COMPANY_NAME_EN,
  CANONICAL_COMPANY_NAME_AR,
  CANONICAL_CURRENCY,
  DEFAULT_COMPANY_NAME,
  isDefaultCompany,
  isReservedCompanyName,
} from "./constants/company";
import type { CompanyProfile } from "@/features/companies/types/company.types";

/**
 * Resolves the authoritative DArrow company ID from a list of loaded companies.
 * Prioritizes the canonical company ID "darrow" if present in Firestore.
 */
export function resolveDefaultCompanyId(
  companies: Array<Pick<CompanyProfile, "id"> & { name?: string }>
): string | null {
  if (!companies || companies.length === 0) return null;

  // 1. Canonical ID exact match
  const exact = companies.find((c) => c.id === CANONICAL_COMPANY_ID);
  if (exact) return exact.id;

  // 2. Normalized match against DArrow
  const match = companies.find((c) => isDefaultCompany(c.id, c.name));
  return match ? match.id : null;
}

/**
 * Ensures a valid companyId is selected.
 * 1. If an explicit valid companyId is provided, returns it directly.
 * 2. If not provided, attempts to resolve DArrow from available companies.
 * 3. If still unresolved and a fallback is allowed/configured, returns fallback.
 */
export function getOrResolveCompanyId(
  explicitCompanyId: string | null | undefined,
  companies: Array<Pick<CompanyProfile, "id"> & { name?: string }>,
  fallbackId?: string
): string | null {
  const trimmed = explicitCompanyId?.trim();
  if (trimmed) return trimmed;

  const resolved = resolveDefaultCompanyId(companies);
  if (resolved) return resolved;

  if (fallbackId && fallbackId.trim()) {
    return fallbackId.trim();
  }

  return null;
}

export {
  CANONICAL_COMPANY_ID,
  CANONICAL_COMPANY_NAME_EN,
  CANONICAL_COMPANY_NAME_AR,
  CANONICAL_CURRENCY,
  DEFAULT_COMPANY_NAME,
  isDefaultCompany,
  isReservedCompanyName,
};
