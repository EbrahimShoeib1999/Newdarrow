/**
 * D-Arrow — Centralized Company Identity Constants
 * ============================================================
 * Defines the canonical DArrow company identity and identity validation helpers.
 *
 * Invariant:
 *   - Only ONE authoritative DArrow company identity exists for this organization.
 *   - Canonical document ID: "darrow"
 *   - Official English display name: "DArrow"
 *   - Official Arabic name: "دي أرو"
 *   - Canonical operational currency: "SAR"
 */

export const DEFAULT_COMPANY_NAME = "DArrow";
export const DEFAULT_COMPANY_NAME_ALT = "D-Arrow";
export const CANONICAL_COMPANY_ID = "darrow";
export const CANONICAL_COMPANY_NAME_EN = "DArrow";
export const CANONICAL_COMPANY_NAME_AR = "دي أرو";
export const CANONICAL_CURRENCY = "SAR";

/**
 * Checks whether a given company identifier or display name corresponds to DArrow.
 * Strips whitespace, hyphens, and underscores for reliable match across legacy records.
 */
export function isDefaultCompany(id?: string | null, name?: string | null): boolean {
  if (!id && !name) return false;
  const normalizedId = (id || "").toLowerCase().replace(/[\s\-_]/g, "");
  const normalizedName = (name || "").toLowerCase().replace(/[\s\-_]/g, "");
  return (
    normalizedId === "darrow" ||
    normalizedId.includes("darrow") ||
    normalizedName === "darrow" ||
    normalizedName.includes("darrow") ||
    normalizedName.includes("ديأرو") ||
    normalizedName.includes("دي أرو")
  );
}

/**
 * Checks whether a candidate company name from public registration attempts to claim
 * or duplicate the DArrow organization.
 */
export function isReservedCompanyName(name: string): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase().replace(/[\s\-_]/g, "");
  return (
    normalized === "darrow" ||
    normalized.includes("darrow") ||
    normalized.includes("ديأرو") ||
    normalized.includes("دي أرو")
  );
}
