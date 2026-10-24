import type { Location } from "react-router-dom";

/**
 * Canonical post-authentication landing contract.
 *
 * Every flow that completes Firebase authentication (email/password login,
 * Google sign-in, registration, invite acceptance) must resolve its next
 * navigation through this helper so an authenticated user is never dropped on
 * the public marketing homepage at "/".
 */

export const PORTAL_PICKER_PATH = "/apps";

const PUBLIC_AUTH_PATHS = new Set(["/login", "/register", "/forgot-password", "/reset-password"]);

/**
 * Only allow validated internal destinations. Rejects protocol-relative
 * ("//evil.com"), scheme-qualified and backslash-obfuscated targets so a
 * forged `from` value can never produce an open redirect.
 */
export function isSafeInternalPath(pathname: unknown): pathname is string {
  return (
    typeof pathname === "string" &&
    pathname.startsWith("/") &&
    !pathname.startsWith("//") &&
    !pathname.includes("\\")
  );
}

type LocationLike = Pick<Location, "state" | "pathname" | "search" | "hash">;

export interface PostLoginTarget {
  to: string;
  state?: { choosePortal: boolean };
}

/**
 * Resolve where a just-authenticated user should go:
 * 1. The protected route they originally requested (`state.from` set by
 *    ProtectedRoute), when it is a safe internal app destination.
 * 2. Otherwise the portal picker with the explicit `choosePortal` intent,
 *    which lets PortalPickerPage auto-route single-portal users to their
 *    dashboard instead.
 */
export function resolvePostLoginTarget(location: LocationLike): PostLoginTarget {
  const from = (location.state as { from?: Partial<Location> } | null)?.from;
  const fromPathname = from?.pathname;

  if (
    isSafeInternalPath(fromPathname) &&
    !PUBLIC_AUTH_PATHS.has(fromPathname) &&
    fromPathname !== PORTAL_PICKER_PATH
  ) {
    // Query and fragment are only reflected when they are well-formed
    // ("?..." / "#..."); anything else is dropped rather than concatenated.
    const search = typeof from?.search === "string" && from.search.startsWith("?") ? from.search : "";
    const hash = typeof from?.hash === "string" && from.hash.startsWith("#") ? from.hash : "";
    return { to: `${fromPathname}${search}${hash}` };
  }

  return { to: PORTAL_PICKER_PATH, state: { choosePortal: true } };
}

/** True when a navigation to "/" carries a completed-authentication intent. */
export function hasPostLoginIntent(location: LocationLike): boolean {
  return Boolean((location.state as { choosePortal?: boolean } | null)?.choosePortal);
}
