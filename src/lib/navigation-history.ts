/**
 * Global in-app navigation history (Back/Forward).
 *
 * React Router owns the browser history stack, but exposes no API for the
 * current position or the existence of forward entries, so a shared header
 * control cannot ask "is Forward available?" through public routes alone.
 * This module keeps a lightweight mirror of the router's own stack — updated
 * ONLY from real router transitions (PUSH / POP / REPLACE observed centrally
 * in AppLayout), never a duplicate event bus — so Back/Forward resolve the
 * user's actual visit order instead of jumping to the dashboard.
 *
 * Pure module (no React), same contract style as route-navigation.ts:
 * - applyNavigation() is the single reducer; the hook feeds it router events
 *   and useSyncExternalStore reads the result;
 * - entries are addressed by router location.key, which uniquely identifies a
 *   history entry within the document — that is how POP (browser back/forward,
 *   or navigate(-1)/(+1)) repositions the pointer instead of appending;
 * - a POP for an entry we never saw (document reload, tab restore) reseeds the
 *   stack with that single entry: Back/Forward become unavailable rather than
 *   inventing history — the per-page registry BackBar still offers its
 *   authorization-checked smart fallback in that case;
 * - redirect dedupe: a PUSH whose URL equals the current entry only replaces
 *   its key (a <Navigate> to the same view must never stack duplicates); a
 *   PUSH that repeats a URL already elsewhere in the stack is still appended,
 *   because the browser allows visiting a page twice.
 *
 * Safety mirrors the task contract:
 * - in-memory only (nothing persisted: no session URLs in storage);
 * - resetNavHistory() runs on identity/company change so Back can never carry
 *   one tenant's trail into another tenant's session;
 * - navigate() itself stays guarded by ProtectedRoute + ActivityRouteGuard:
 *   moving the pointer to a recorded entry cannot grant access the router
 *   would not already allow for that URL.
 */

export interface NavHistoryEntry {
  /** Router location.key — unique per browser history entry in this document. */
  key: string;
  /** Full in-app URL: pathname + search + hash (query/hash round-trip intact). */
  url: string;
}

export interface NavHistoryState {
  entries: NavHistoryEntry[];
  /** Pointer into entries for the location the user is on right now. */
  index: number;
  /** Monotonic tick so useSyncExternalStore sees same-content updates as new. */
  version: number;
}

/** Hard cap on the mirrored stack; older entries drop off the front (the
 *  pointer keeps pointing at the same entry). Prevents unbounded memory on
 *  long-lived sessions with heavy filtering churn. */
const MAX_ENTRIES = 100;

export type NavAction =
  | { type: "PUSH"; key: string; url: string }
  | { type: "REPLACE"; key: string; url: string }
  | { type: "POP"; key: string; url: string };

let state: NavHistoryState = { entries: [], index: -1, version: 0 };
const listeners = new Set<() => void>();

function emit() {
  state = { ...state, version: state.version + 1 };
  listeners.forEach((l) => l());
}

export function getNavHistorySnapshot(): NavHistoryState {
  return state;
}

export function subscribeNavHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test/session seam — wipe the mirrored stack (logout, company switch). */
export function resetNavHistory(): void {
  state = { entries: [], index: -1, version: 0 };
  listeners.forEach((l) => l());
}

/**
 * Fold one router transition into the mirrored stack.
 * `url` is compared WITHOUT a leading slash so an initial "/" document and a
 * router-normalized "/" location are recognized as the same entry.
 */
export function applyNavigation(action: NavAction): void {
  const url = normalizeUrl(action.url);

  if (state.entries.length === 0) {
    // First observation of the session (or a reseed after a reset): this
    // single entry is the whole known history — nothing to go back to.
    state = { entries: [{ key: action.key, url }], index: 0, version: state.version };
    emit();
    return;
  }

  const seenAt = state.entries.findIndex((e) => e.key === action.key);

  if (action.type === "POP") {
    if (seenAt >= 0) {
      if (seenAt !== state.index) {
        state = { ...state, index: seenAt };
        emit();
      }
      return;
    }
    // POP to an entry this document never recorded — reload or tab restore.
    // Never guess history: reseed to a single, non-navigable position.
    state = { entries: [{ key: action.key, url }], index: 0, version: state.version };
    emit();
    return;
  }

  const current = state.entries[state.index];

  // Redirect onto the very URL we are on (<Navigate replace>, repeat of the
  // same view): swap the key so future POPs still resolve, add nothing.
  if (url === current.url) {
    if (action.key !== current.key) {
      const entries = state.entries.slice();
      entries[state.index] = { key: action.key, url };
      state = { ...state, entries };
      emit();
    }
    return;
  }

  if (action.type === "REPLACE") {
    // History.replace(): overwrite the current entry, forward entries stay
    // (the browser can still move forward past a replace).
    const entries = state.entries.slice();
    entries[state.index] = { key: action.key, url };
    state = { ...state, entries };
    emit();
    return;
  }

  // PUSH at a non-tip position truncates the forward branch exactly like the
  // browser does (A → B → C, back to B, push D → C is no longer forwardable).
  const kept = state.entries.slice(0, state.index + 1);
  kept.push({ key: action.key, url });
  let index = kept.length - 1;
  let entries = kept;
  if (entries.length > MAX_ENTRIES) {
    const overflow = entries.length - MAX_ENTRIES;
    entries = entries.slice(overflow);
    index -= overflow;
  }
  state = { ...state, entries, index };
  emit();
}

function normalizeUrl(url: string): string {
  const trimmed = url.startsWith("/") ? url : `/${url}`;
  return trimmed.length > 1 && trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export interface NavHistoryRead {
  entries: NavHistoryEntry[];
  index: number;
  canBack: boolean;
  canForward: boolean;
}

/** Read-model for the header controls (pure, also used by unit tests). */
export function readNavHistory(s: NavHistoryState): NavHistoryRead {
  return {
    entries: s.entries,
    index: s.index,
    canBack: s.index > 0,
    canForward: s.index >= 0 && s.index < s.entries.length - 1,
  };
}

/** Whether a real in-app previous entry exists for the given stack. The
 *  registry BackBar consults this to prefer true history over its smart
 *  fallback resolution (direct entry / no recorded history → fallback). */
export function hasRealBackHistory(s: NavHistoryState = state): boolean {
  return s.index > 0;
}
