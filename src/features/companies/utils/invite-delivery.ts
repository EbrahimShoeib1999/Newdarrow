/**
 * Pure, framework-free helpers for the invitation-delivery contract.
 *
 * These encode the two invariants the audit flagged as safety-critical and
 * keep them testable without EmailJS, Firebase, or `import.meta.env`:
 *
 *   1. Honesty — the UI must never present a failed/unconfigured email send as
 *      if the invitation was actually delivered.
 *   2. Retry safety — resending must reuse the EXISTING pending invite and must
 *      be blocked for accepted / expired / revoked / missing invites, so a
 *      retry can never create a duplicate active invitation.
 */

/**
 * Delivery outcome reported by the email layer.
 *   - "sent":   the provider accepted the request (email actually went out).
 *   - "logged": provider not configured OR the request failed — the invite
 *               document still exists and its link is valid, but no email was
 *               delivered. Callers MUST surface this as "not sent".
 */
export type InviteDeliveryMode = "sent" | "logged";

/** The only truthy signal that an email truly left the system. */
export function emailActuallySent(mode: InviteDeliveryMode): boolean {
  return mode === "sent";
}

/** Minimal shape needed to decide whether a resend is allowed. */
export interface ResendableInvite {
  status: string; // "pending" | "accepted" | "expired" | "revoked"
  expiresAt: string; // ISO string
}

/**
 * Returns the reason a resend must be blocked, or `null` when a resend may
 * proceed. Kept as a pure predicate so the exact same logic backs both the
 * service guard and the regression tests.
 */
export function resendBlockedReason(
  invite: ResendableInvite | null,
  now: number = Date.now()
): "not_found" | "not_pending" | "expired" | null {
  if (!invite) return "not_found";
  if (invite.status !== "pending") return "not_pending";
  if (new Date(invite.expiresAt).getTime() <= now) return "expired";
  return null;
}

/** Convenience boolean wrapper around {@link resendBlockedReason}. */
export function canResendInvite(
  invite: ResendableInvite | null,
  now: number = Date.now()
): boolean {
  return resendBlockedReason(invite, now) === null;
}

/**
 * Maps an internal block reason to the stable error code the service throws so
 * the UI can translate it. Keeping the mapping pure means the thrown codes are
 * covered by unit tests without running Firebase.
 */
export function resendBlockedErrorCode(
  reason: Exclude<ReturnType<typeof resendBlockedReason>, null>
): string {
  switch (reason) {
    case "not_found":
      return "INVITE_NOT_FOUND";
    case "not_pending":
      return "INVITE_NOT_PENDING";
    case "expired":
      return "INVITE_EXPIRED";
  }
}
