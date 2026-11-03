import { PeopleService } from "../api/people.service";
import type { AttendanceGeoPayload, WorkLocation, AttendanceLatePolicy } from "../types/people.types";
import {
  AttendanceGeoError,
  findMatchingWorkLocation,
  getCurrentCoordinates,
  nearestWorkLocation,
} from "./geo";

export async function captureAttendanceGeo(
  companyId: string,
  employeeId: string
): Promise<AttendanceGeoPayload | undefined> {
  const empRes = await PeopleService.getEmployee(companyId, employeeId);
  const employee = empRes.data;

  // A worker explicitly authorized to be off-site must not be trapped by the
  // office geofence. Such employees default to flexible capture, and even when
  // left in geofence mode are never hard-blocked for having no assigned
  // location — there is simply no fence to enforce for them (Saudi-labor /
  // remote-work requirement: no office GPS for remote-authorized staff).
  const remoteAuthorized =
    employee.workType === "remote" ||
    employee.allowRemoteTimer === true ||
    employee.workType === "field" ||
    employee.workMode === "remote" ||
    employee.workMode === "field";

  const mode =
    employee.attendanceCheckMode ?? (remoteAuthorized ? "flexible" : "geofence");

  const locRes = await PeopleService.getWorkLocations(companyId);
  const assigned = (employee.attendanceLocationIds ?? [])
    .map((id) => locRes.data.find((l) => l.id === id))
    .filter((l): l is WorkLocation => !!l && l.isActive);

  if (mode === "flexible" || (remoteAuthorized && assigned.length === 0)) {
    try {
      const coords = await getCurrentCoordinates();
      const nearest = nearestWorkLocation(coords, assigned.length ? assigned : locRes.data);
      return {
        lat: coords.lat,
        lng: coords.lng,
        accuracyMeters: coords.accuracyMeters,
        locationId: nearest?.location.id,
        locationName: nearest?.location.name,
        distanceMeters: nearest
          ? Math.round(nearest.distanceMeters)
          : undefined,
      };
    } catch {
      return undefined;
    }
  }

  if (assigned.length === 0) {
    // A geofence employee WITH assignment references that resolve to nothing
    // (deleted or deactivated work locations) is a tenant configuration
    // problem — reporting it as "never assigned" sends HR chasing the wrong
    // fix. The two causes get distinct, actionable codes.
    const rawIds = employee.attendanceLocationIds ?? [];
    if (rawIds.length > 0) {
      throw new AttendanceGeoError(
        "location_inactive",
        "Assigned work locations are missing or inactive"
      );
    }
    throw new AttendanceGeoError("not_assigned", "No attendance location assigned");
  }

  // Active office employee with an active office assignment:
  let policy: AttendanceLatePolicy | null = null;
  try {
    const pRes = await PeopleService.attendanceSettings.get(companyId);
    policy = pRes?.data ?? null;
  } catch {
    policy = null;
  }

  const isGpsMandatory =
    employee.requireGps === true ||
    employee.mandatoryGps === true ||
    policy?.requireGps === true ||
    policy?.mandatoryGps === true;

  const isGeofenceDisabled =
    policy?.geofenceEnabled === false ||
    employee.geofenceEnabled === false ||
    policy?.requireGps === false ||
    employee.requireGps === false ||
    (assigned.length > 0 && assigned.every((l) => l.geofenceEnabled === false));

  // If Geofence is explicitly disabled or GPS explicitly not required:
  if (isGeofenceDisabled) {
    return {
      lat: assigned[0].lat,
      lng: assigned[0].lng,
      distanceMeters: 0,
      locationId: assigned[0].id,
      locationName: assigned[0].name,
    };
  }

  let coords: { lat: number; lng: number; accuracyMeters?: number } | null = null;
  try {
    coords = await getCurrentCoordinates();
  } catch (err) {
    if (isGpsMandatory) {
      if (err instanceof AttendanceGeoError) throw err;
      throw new AttendanceGeoError("permission_denied", "GPS is required by policy");
    }
    // "Do not require GPS for office employees unless explicitly configured":
    return {
      lat: assigned[0].lat,
      lng: assigned[0].lng,
      distanceMeters: 0,
      locationId: assigned[0].id,
      locationName: assigned[0].name,
    };
  }

  const match = findMatchingWorkLocation(coords, assigned);
  if (!match) {
    const nearest = nearestWorkLocation(coords, assigned);
    throw new AttendanceGeoError("outside", "Outside assigned work location", {
      distanceMeters: nearest ? Math.round(nearest.distanceMeters) : undefined,
      radiusMeters: nearest?.location.radiusMeters,
      locationName: nearest?.location.name,
    });
  }

  return {
    lat: coords.lat,
    lng: coords.lng,
    accuracyMeters: coords.accuracyMeters,
    locationId: match.location.id,
    locationName: match.location.name,
    distanceMeters: Math.round(match.distanceMeters),
  };
}
