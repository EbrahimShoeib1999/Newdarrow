import type { AttendanceGeoPayload, Employee, WorkLocation } from "../types/people.types";
import { initialsFromName, localizedName, nameFromEmail } from "@/lib/localized-name";

export type AttendanceGeoCode =
  | "permission_denied"
  | "unavailable"
  | "timeout"
  | "not_assigned"
  | "location_inactive"
  | "outside"
  | "no_employee";

export class AttendanceGeoError extends Error {
  code: AttendanceGeoCode;
  extra?: {
    distanceMeters?: number;
    radiusMeters?: number;
    locationName?: string;
  };

  constructor(
    code: AttendanceGeoCode,
    message: string,
    extra?: {
      distanceMeters?: number;
      radiusMeters?: number;
      locationName?: string;
    }
  ) {
    super(message);
    this.name = "AttendanceGeoError";
    this.code = code;
    this.extra = extra;
  }
}

export function employeeDisplayName(
  employee: Pick<Employee, "firstName" | "lastName" | "email"> & {
    name?: string;
    nameAr?: string;
  },
  locale?: string
): string {
  const fromParts = `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim();
  const bilingual = localizedName(locale, {
    name: fromParts || employee.name,
    nameAr: employee.nameAr,
  });
  if (bilingual) return bilingual;
  const fromEmail = nameFromEmail(employee.email);
  if (fromEmail) return fromEmail;
  return employee.email?.trim() || "—";
}

export function employeeInitials(
  employee: Pick<Employee, "firstName" | "lastName" | "email"> & {
    name?: string;
    nameAr?: string;
  },
  locale?: string
): string {
  return initialsFromName(employeeDisplayName(employee, locale), "?");
}

/** Earth-surface distance in meters. */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function getCurrentCoordinates(): Promise<{
  lat: number;
  lng: number;
  accuracyMeters?: number;
}> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new AttendanceGeoError("unavailable", "Geolocation is not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new AttendanceGeoError("permission_denied", err.message));
        } else if (err.code === err.TIMEOUT) {
          reject(new AttendanceGeoError("timeout", err.message));
        } else {
          reject(new AttendanceGeoError("unavailable", err.message));
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

export function findMatchingWorkLocation(
  coords: { lat: number; lng: number },
  locations: WorkLocation[]
): { location: WorkLocation; distanceMeters: number } | null {
  let best: { location: WorkLocation; distanceMeters: number } | null = null;
  for (const loc of locations) {
    if (!loc.isActive) continue;
    const distanceMeters = haversineMeters(coords, { lat: loc.lat, lng: loc.lng });
    if (distanceMeters <= loc.radiusMeters) {
      if (!best || distanceMeters < best.distanceMeters) {
        best = { location: loc, distanceMeters };
      }
    }
  }
  return best;
}

export function nearestWorkLocation(
  coords: { lat: number; lng: number },
  locations: WorkLocation[]
): { location: WorkLocation; distanceMeters: number } | null {
  const active = locations.filter((l) => l.isActive);
  if (active.length === 0) return null;
  return active.reduce<{ location: WorkLocation; distanceMeters: number } | null>(
    (best, loc) => {
      const distanceMeters = haversineMeters(coords, {
        lat: loc.lat,
        lng: loc.lng,
      });
      if (!best || distanceMeters < best.distanceMeters) {
        return { location: loc, distanceMeters };
      }
      return best;
    },
    null
  );
}

export function osmEmbedUrl(lat: number, lng: number, radiusMeters = 150): string {
  const pad = Math.max(0.004, radiusMeters / 111000 + 0.002);
  const bbox = `${lng - pad},${lat - pad},${lng + pad},${lat + pad}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}

export async function searchNominatim(query: string): Promise<
  { label: string; lat: number; lng: number }[]
> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "ar,en",
    },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { display_name: string; lat: string; lon: string }[];
  return data.map((item) => ({
    label: item.display_name,
    lat: Number(item.lat),
    lng: Number(item.lon),
  }));
}

/**
 * Firestore rejects explicit `undefined` values in a write payload
 * ("Unsupported field value: undefined"). Optional geo facts simply do not
 * exist when they could not be resolved — e.g. a flexible check-in with
 * working GPS in a company that has no work locations configured yet. Those
 * fields are omitted entirely rather than written with placeholder data.
 */
export function pruneUndefinedFields<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

/** Firestore check-in fields derived from a captured geo payload (empty when GPS was skipped). */
export function buildCheckInGeoFields(geo?: AttendanceGeoPayload): Record<string, unknown> {
  if (!geo) return {};
  return pruneUndefinedFields({
    checkInLat: geo.lat,
    checkInLng: geo.lng,
    // Legacy display field: only meaningful when a named location matched.
    location: geo.locationName,
    checkInLocationId: geo.locationId,
    checkInLocationName: geo.locationName,
    checkInDistanceMeters: geo.distanceMeters,
  });
}

/** Firestore check-out fields derived from a captured geo payload (empty when GPS was skipped). */
export function buildCheckOutGeoFields(geo?: AttendanceGeoPayload): Record<string, unknown> {
  if (!geo) return {};
  return pruneUndefinedFields({
    checkOutLat: geo.lat,
    checkOutLng: geo.lng,
    checkOutLocationId: geo.locationId,
    checkOutLocationName: geo.locationName,
    checkOutDistanceMeters: geo.distanceMeters,
  });
}

/**
 * A day's attendance record is an open session when it carries no checkOut.
 * Used to make retries idempotent so a failed-then-repeated check-in can never
 * leave two active shifts for the same employee on the same day.
 */
export function isOpenSessionForDay(
  record: { date?: string; checkOut?: unknown } | undefined | null,
  today: string
): boolean {
  return !!record && record.date === today && !record.checkOut;
}

/**
 * Employment gate: only live records may open a shift. 'onboarding' and
 * (unknown/legacy) statuses stay eligible — blocking them would lock out
 * hires the current flows already allow to punch.
 */
export function isEmploymentActive(status?: string | null): boolean {
  return status !== "terminated" && status !== "suspended";
}

/** Stable reason codes for "why can't this employee start?". */
export type CheckInBlockCode =
  | "employment_inactive"
  | "location_not_assigned"
  | "location_inactive";

/**
 * Pure pre-click readiness: explains a blocked start INSTEAD of silently
 * hiding or disabling the control. Mirrors captureAttendanceGeo's decisions
 * exactly (same remote-authorization and mode precedence) so the explanation
 * never contradicts what the click path enforces.
 * `knownLocations` is the company's work-location list when it could be read;
 * null means "unknown" — dangling/inactive references then stay silent here
 * and the click path reports them as an actionable error.
 */
export function resolveCheckInBlockReason(
  employee:
    | Pick<
        Employee,
        "status" | "workType" | "workMode" | "allowRemoteTimer" | "attendanceCheckMode" | "attendanceLocationIds"
      >
    | null
    | undefined,
  knownLocations: { id: string; isActive?: boolean }[] | null
): CheckInBlockCode | null {
  if (!employee) return null;
  if (!isEmploymentActive(employee.status)) return "employment_inactive";
  // Keep this EXACTLY in sync with captureAttendanceGeo's remote-authorization
  // test (attendance-geo-check.ts). A worker authorized off-site by work MODE
  // (remote/field) or by the field work TYPE is just as remote-authorized as
  // one flagged by workType==="remote" — otherwise this pre-click explanation
  // tells a legitimately-remote employee they are blocked on a location that
  // the actual click path never enforces for them (the reported asymmetry).
  const remoteAuthorized =
    employee.workType === "remote" ||
    employee.allowRemoteTimer === true ||
    employee.workType === "field" ||
    employee.workMode === "remote" ||
    employee.workMode === "field";
  const mode =
    employee.attendanceCheckMode ?? (remoteAuthorized ? "flexible" : "geofence");
  if (mode === "flexible" || remoteAuthorized) return null;
  const ids = employee.attendanceLocationIds ?? [];
  if (ids.length === 0) return "location_not_assigned";
  if (
    knownLocations != null &&
    !ids.some((id) =>
      knownLocations.some((l) => l.id === id && l.isActive !== false)
    )
  ) {
    return "location_inactive";
  }
  return null;
}

/**
 * Coarse class of a timer failure, resolved from the error's own stable
 * identifiers — never from the message string. Keeping the auth/authorization
 * distinction here prevents a Firestore write fault from being presented as a
 * login problem (and vice versa).
 */
export type AttendanceErrorClass =
  | "gps_denied"
  | "gps_unavailable"
  | "location_not_assigned"
  | "location_inactive"
  | "employment_inactive"
  | "outside"
  | "session_expired"
  | "action_forbidden"
  | "network_unavailable"
  | "write_failed";

export function classifyAttendanceError(error: unknown): AttendanceErrorClass {
  if (error instanceof AttendanceGeoError) {
    if (error.code === "permission_denied") return "gps_denied";
    if (error.code === "unavailable" || error.code === "timeout") return "gps_unavailable";
    if (error.code === "not_assigned") return "location_not_assigned";
    if (error.code === "location_inactive") return "location_inactive";
    if (error.code === "outside") return "outside";
    return "write_failed";
  }
  // Firestore and Auth errors carry a stable `code` field.
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  if (code === "unauthenticated") return "session_expired";
  if (code === "permission-denied") return "action_forbidden";
  if (code === "unavailable") return "network_unavailable";
  // The service-side employment gate throws with this stable code.
  if (code === "employment_inactive") return "employment_inactive";
  return "write_failed";
}
