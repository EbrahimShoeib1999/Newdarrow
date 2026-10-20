/**
 * Invitation Delivery & Resend-Safety Regression Suite
 *
 * Covers the confirmed browser failure where `InvitesService:createInvite`
 * surfaced an EmailJS `EmailJSResponseStatus` (HTTP 426) while the employee +
 * invite were already persisted. The audit requirements encoded here:
 *
 *   1. Honesty — a failed (or unconfigured) email must NEVER be reported as
 *      "sent". Only `emailMode === "sent"` may claim delivery.
 *   2. Retry safety — resending reuses the EXISTING pending invite and is
 *      blocked for accepted / expired / revoked / missing invites, so a retry
 *      can never create a duplicate active invitation.
 *   3. Distinct, translatable failure codes for each block reason.
 *
 * These are pure predicates from `invite-delivery.ts`, the same functions the
 * production service calls, so no Firebase/EmailJS runtime is required.
 *
 * Run with: npx tsx scripts/test-invite-delivery.ts
 */

import {
  canResendInvite,
  emailActuallySent,
  resendBlockedErrorCode,
  resendBlockedReason,
} from "../src/features/companies/utils/invite-delivery";

const results: { name: string; ok: boolean; details?: string }[] = [];

function check(name: string, cond: boolean, details?: string) {
  if (!cond) throw new Error(`${name}${details ? ` — ${details}` : ""}`);
}

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✓ PASS: ${name}`);
  } catch (err: any) {
    const msg = err?.message || String(err);
    results.push({ name, ok: false, details: msg });
    console.error(`✗ FAIL: ${name}\n  Error: ${msg}`);
  }
}

// Fixed clock so expiry assertions are deterministic.
const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const FUTURE = new Date(NOW + 7 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(NOW - 1000).toISOString();

async function main() {
  await test("email failure / unconfigured is never reported as sent", () => {
    check("logged → not sent", emailActuallySent("logged") === false);
    check("sent → sent", emailActuallySent("sent") === true);
  });

  await test("pending, unexpired invite may be resent", () => {
    const invite = { status: "pending", expiresAt: FUTURE };
    check("canResendInvite true", canResendInvite(invite, NOW) === true);
    check("no block reason", resendBlockedReason(invite, NOW) === null);
  });

  await test("expired pending invite is blocked as expired", () => {
    const invite = { status: "pending", expiresAt: PAST };
    check("cannot resend", canResendInvite(invite, NOW) === false);
    check(
      "reason expired",
      resendBlockedReason(invite, NOW) === "expired",
      resendBlockedReason(invite, NOW) ?? "null"
    );
  });

  await test("accepted invite is blocked (no re-delivery, no duplicate)", () => {
    const invite = { status: "accepted", expiresAt: FUTURE };
    check(
      "reason not_pending",
      resendBlockedReason(invite, NOW) === "not_pending"
    );
  });

  await test("revoked invite is blocked as not_pending", () => {
    const invite = { status: "revoked", expiresAt: FUTURE };
    check(
      "reason not_pending",
      resendBlockedReason(invite, NOW) === "not_pending"
    );
  });

  await test("missing invite (null) is blocked as not_found", () => {
    check("cannot resend null", canResendInvite(null, NOW) === false);
    check("reason not_found", resendBlockedReason(null, NOW) === "not_found");
  });

  await test("each block reason maps to a distinct, stable error code", () => {
    check(
      "not_found code",
      resendBlockedErrorCode("not_found") === "INVITE_NOT_FOUND"
    );
    check(
      "not_pending code",
      resendBlockedErrorCode("not_pending") === "INVITE_NOT_PENDING"
    );
    check("expired code", resendBlockedErrorCode("expired") === "INVITE_EXPIRED");
    const codes = new Set([
      resendBlockedErrorCode("not_found"),
      resendBlockedErrorCode("not_pending"),
      resendBlockedErrorCode("expired"),
    ]);
    check("all codes distinct", codes.size === 3);
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main();
