/**
 * WhatsApp support entry — pure builders, no side effects (fully unit-testable).
 *
 * Security / product stance (Phase 8D):
 *  - The support number is NEVER invented. It comes only from tenant configuration
 *    (Company → Support settings) supplied by the caller. If it is missing or not a
 *    plausible international/digit number, we return null and the UI shows a
 *    disabled state — we never fabricate or guess a contact.
 *  - Prefilled messages must not carry secrets, tokens, passwords, or private
 *    financial/customer data. We only ever include an optional safe PAGE REFERENCE
 *    (the current route path), never query values or record contents.
 */

export type SupportLang = "ar" | "en";

/** Strip everything that is not a digit or a leading "+". wa.me wants digits only. */
export function normalizeSupportPhone(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Keep only digits; a leading + is dropped because wa.me uses digits-only numbers.
  let digits = trimmed.replace(/\D/g, "");
  // Accept the 00 international dialling prefix by converting it to the
  // digits-only country-code form wa.me expects (e.g. 00966… -> 966…).
  digits = digits.replace(/^0+/, "");
  // A wa.me number needs at least a country code + subscriber: guard short junk.
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/**
 * Keep only a safe page reference. Trims to the path (drops query/hash so no
 * token/id values leak) and caps length. Returns undefined when there is nothing
 * safe to include.
 */
export function safePageReference(input?: string | null): string | undefined {
  if (!input) return undefined;
  // Drop query string and fragment; keep a bare path like /projects/abc.
  const path = String(input).split("?")[0].split("#")[0];
  const clean = path.replace(/\s+/g, "").slice(0, 80);
  return clean && clean !== "/" ? clean : undefined;
}

/** Localized prefilled support message. Only the safe page ref is interpolated. */
export function buildSupportMessage(
  lang: SupportLang,
  opts?: { pageRef?: string; ticketId?: string }
): string {
  const pageRef = opts?.pageRef;
  const ticketId = opts?.ticketId;
  if (lang === "ar") {
    const parts = ["مرحبًا، أحتاج دعمًا في نظام د-سهم."];
    if (pageRef) parts.push(`الصفحة: ${pageRef}`);
    if (ticketId) parts.push(`رقم الطلب: ${ticketId}`);
    return parts.join(" ");
  }
  const parts = ["Hello, I need support with the D-Arrow system."];
  if (pageRef) parts.push(`Page: ${pageRef}`);
  if (ticketId) parts.push(`Ticket: ${ticketId}`);
  return parts.join(" ");
}

/**
 * Build a wa.me chat URL. Returns null when the phone is unconfigured/invalid so
 * callers render an honest "not configured" state instead of a broken link.
 */
export function buildSupportWhatsAppUrl(
  phone: string | null | undefined,
  message: string
): string | null {
  const normalized = normalizeSupportPhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
