import {
  collection,
  getDocs,
  getDoc,
  doc,
  addDoc,
  updateDoc,
  setDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
  Timestamp
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { ApiResponse } from "@/types/api.types";
import { withLogging } from "@/lib/service-utils";
import type {
  Employee,
  LeaveRequest,
  PerformanceReview,
  Attendance,
  LeaveStatus,
  Asset,
  Announcement,
  WorkLocation,
  CreateWorkLocationDTO,
  AttendanceGeoPayload,
  AttendanceLatePolicy,
} from "../types/people.types";
import { DEFAULT_ATTENDANCE_LATE_POLICY } from "../types/people.types";
import {
  buildCheckInGeoFields,
  buildCheckOutGeoFields,
  isEmploymentActive,
  isOpenSessionForDay,
  pruneUndefinedFields,
} from "../utils/geo";
import type {
  AttendanceCorrectionEntry,
  AttendanceScheduleSnapshot,
  ScheduleAssignment,
  ScheduleValues,
} from "../types/work-schedule.types";
import {
  canonicalLateness,
  countableLateMinutes,
  cutoffLateMinutes,
  effectivePunchTimezone,
  effectiveValuesOf,
  FALLBACK_TIMEZONE,
  isValidTimezone,
  punctualityForCheckIn,
  resolveEffectiveTimezone,
  zonedDayKeyOf,
} from "../lib/work-schedule-rules";
import { WorkScheduleService } from "./work-schedule.service";
import { useAuthStore } from "@/stores/auth.store";
import { hasEffectivePermission } from "@/lib/permissions/effective-permissions";

const SERVICE_NAME = "PeopleService";

/** Thrown so callers can show a field-level message instead of a generic failure. */
export const EMPLOYEE_EMAIL_EXISTS = "EMPLOYEE_EMAIL_EXISTS";
export const EMPLOYEE_EMAIL_REQUIRED = "EMPLOYEE_EMAIL_REQUIRED";

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export interface EmployeeEmailCheck {
  /** Another employee in this company already uses the email. */
  isTaken: boolean;
  /** A platform account with this email exists in this company. */
  hasAccount: boolean;
  /** Id of that account, so the employee record can point at it. */
  linkedUserId: string;
}

/**
 * Compares normalized values instead of using an equality query, so employees
 * saved before emails were normalized still count as duplicates.
 * `excludeEmployeeId` keeps an employee from clashing with itself on edit.
 */
async function lookupEmployeeEmail(
  companyId: string,
  email: string,
  excludeEmployeeId?: string
): Promise<EmployeeEmailCheck> {
  const [employeesSnap, usersSnap] = await Promise.all([
    getDocs(collection(db, "companies", companyId, "employees")),
    // Scoped to the company because the security rules only expose teammates.
    getDocs(
      query(
        collection(db, "users"),
        where("companyId", "==", companyId),
        where("email", "==", email)
      )
    ),
  ]);

  return {
    isTaken: employeesSnap.docs.some(
      (docSnap) =>
        docSnap.id !== excludeEmployeeId &&
        normalizeEmail((docSnap.data() as { email?: unknown }).email) === email
    ),
    hasAccount: !usersSnap.empty,
    linkedUserId: usersSnap.docs[0]?.id ?? "",
  };
}

export function canonicalCountryKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  if (
    normalized === "eg" ||
    normalized.includes("egypt") ||
    normalized.includes("cairo") ||
    normalized.includes("alexandria") ||
    normalized.includes("giza")
  ) {
    return "eg";
  }
  if (
    normalized === "sa" ||
    normalized.includes("saudi") ||
    normalized.includes("ksa") ||
    normalized.includes("riyadh") ||
    normalized.includes("jeddah") ||
    normalized.includes("dammam")
  ) {
    return "sa";
  }
  return normalized.replace(/\s+/g, " ");
}

export function normalizeCountryScope(value: unknown): string[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      values
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
        .map((entry) => entry.toUpperCase() === "EG" || entry.toLowerCase().includes("egypt") ? "EG" : entry.toUpperCase() === "SA" || entry.toLowerCase().includes("saudi") || entry.toLowerCase().includes("ksa") ? "SA" : entry)
    )
  );
}

export function filterEmployeesByScope(
  employees: Employee[],
  scope?: {
    role?: string;
    userId?: string;
    branchId?: string;
    workLocationId?: string;
    hasCompanyWideAccess?: boolean;
    countryScope?: readonly string[] | string[] | null;
  }
): Employee[] {
  if (!scope) return employees;

  if (scope.role === "platform_admin" || scope.role === "super_admin" || scope.role === "admin") {
    return employees;
  }

  const isGlobalScope = scope.role === "global_hr_manager";
  const rawCountryScope = scope.countryScope;
  const hasExplicitCountryScope = Array.isArray(rawCountryScope)
    ? rawCountryScope.length > 0
    : Boolean(rawCountryScope);
  const allowedCountries = normalizeCountryScope(rawCountryScope).map((country) => canonicalCountryKey(country));

  if (isGlobalScope) {
    if (scope.hasCompanyWideAccess) {
      if (!hasExplicitCountryScope) return employees;
      return employees.filter((employee) => {
        const employeeCountry = canonicalCountryKey(employee.country || "");
        return employeeCountry === "" || allowedCountries.includes(employeeCountry);
      });
    }

    if (!hasExplicitCountryScope || !allowedCountries.length) return [];

    return employees.filter((employee) => {
      const employeeCountry = canonicalCountryKey(employee.country || "");
      return employeeCountry === "" || allowedCountries.includes(employeeCountry);
    });
  }

  if (scope.hasCompanyWideAccess) return employees;

  if (scope.branchId) {
    return employees.filter((emp) => !emp.branchId || emp.branchId === scope.branchId);
  }

  if (scope.workLocationId) {
    return employees.filter((emp) => !emp.workLocationId || emp.workLocationId === scope.workLocationId);
  }

  if (scope.userId) {
    return employees.filter((emp) => !emp.managerId || emp.managerId === scope.userId);
  }

  return employees;
}

function enrichEmployeeFromUser(
  id: string,
  data: Record<string, unknown>,
  usersById: Map<string, Record<string, unknown>>,
  usersByEmail: Map<string, Record<string, unknown>>
): Employee {
  const userId = String(data.userId || "");
  const email = String(data.email || "")
    .trim()
    .toLowerCase();
  const user =
    (userId && usersById.get(userId)) ||
    (email && usersByEmail.get(email)) ||
    null;

  const userName = typeof user?.name === "string" ? user.name.trim() : "";
  const userNameAr =
    typeof user?.nameAr === "string" ? user.nameAr.trim() : "";
  const userAvatar =
    (typeof user?.avatar === "string" && user.avatar.trim()) ||
    (typeof user?.photoURL === "string" &&
      (user.photoURL as string).trim()) ||
    "";
  const userEmail =
    typeof user?.email === "string" ? user.email.trim() : "";

  const firstName = String(data.firstName || "").trim();
  const lastName = String(data.lastName || "").trim();
  const name =
    String(data.name || "").trim() || userName || undefined;
  const nameAr =
    String(data.nameAr || "").trim() || userNameAr || undefined;
  const avatarUrl =
    String(data.avatarUrl || "").trim() || userAvatar || undefined;
  const joiningDate =
    data.joiningDate instanceof Timestamp
      ? data.joiningDate.toDate().toISOString()
      : data.joiningDate;

  const rawCountry = (data.country as string) || (user?.country as string) || "";
  const officeLocation = (data.officeLocation as string) || "";
  const country =
    rawCountry ||
    (/saudi|riyadh|jeddah|dammam|khobar/i.test(officeLocation)
      ? "Saudi Arabia"
      : /egypt|cairo|alexandria|giza/i.test(officeLocation)
        ? "Egypt"
        : undefined);

  const rawWorkMode = (data.workMode as string) || (data.workType as string) || "";
  const workMode =
    rawWorkMode === "remote"
      ? "remote"
      : rawWorkMode === "field"
        ? "field"
        : rawWorkMode === "onsite" || rawWorkMode === "office"
          ? "office"
          : officeLocation.toLowerCase().startsWith("remot")
            ? "remote"
            : "office";

  const branchId = (data.branchId as string) || (user?.branchId as string) || undefined;
  const workLocationId =
    (data.workLocationId as string) ||
    (user?.workLocationId as string) ||
    (Array.isArray(data.attendanceLocationIds) && data.attendanceLocationIds[0]
      ? String(data.attendanceLocationIds[0])
      : undefined);

  return {
    id,
    ...data,
    firstName,
    lastName,
    name,
    nameAr,
    avatarUrl,
    email: String(data.email || "").trim() || userEmail,
    country,
    workMode,
    branchId,
    workLocationId,
    officeLocation: officeLocation || undefined,
    joiningDate,
  } as Employee;
}

// --- Attendance lateness/deduction policy -----------------------------

const ATTENDANCE_SETTINGS_DOC = (companyId: string) =>
  doc(db, "companies", companyId, "settings", "attendance");

async function getAttendanceLatePolicy(companyId: string): Promise<AttendanceLatePolicy> {
  const snap = await getDoc(ATTENDANCE_SETTINGS_DOC(companyId));
  if (!snap.exists()) return { ...DEFAULT_ATTENDANCE_LATE_POLICY };
  const data = snap.data() as Partial<AttendanceLatePolicy>;
  return {
    lateCutoffTime: data.lateCutoffTime || DEFAULT_ATTENDANCE_LATE_POLICY.lateCutoffTime,
    lateThreshold:
      Number.isFinite(data.lateThreshold) && (data.lateThreshold as number) >= 1
        ? (data.lateThreshold as number)
        : DEFAULT_ATTENDANCE_LATE_POLICY.lateThreshold,
    // Echo the stored zone as-is; the canonical layer validates it on use, so
    // an unsupported/legacy value simply falls through to the UTC fallback and
    // the UI still shows what the tenant picked.
    timezone: typeof data.timezone === "string" && data.timezone.trim() ? data.timezone : null,
  };
}

/** How many of this employee's attendance days were already "late" so far this calendar month. */
async function countLateOccurrencesThisMonth(
  companyId: string,
  employeeId: string,
  monthKey: string, // "YYYY-MM" — the punch's OWN zoned month window
  excludeAttendanceId?: string
): Promise<number> {
  const attendanceRef = collection(db, "companies", companyId, "attendance");
  const q = query(attendanceRef, where("employeeId", "==", employeeId));
  const snapshot = await getDocs(q);
  let count = 0;
  for (const docSnap of snapshot.docs) {
    if (excludeAttendanceId && docSnap.id === excludeAttendanceId) continue;
    const data = docSnap.data() as Attendance;
    // Rows carry their zoned `date`, so a zoned month key matches exactly —
    // the old local-clock key against UTC dates could miss (or double-count)
    // month-boundary punches.
    if (data.status === "late" && typeof data.date === "string" && data.date.startsWith(monthKey)) {
      count += 1;
    }
  }
  return count;
}

/* --- Effective work schedule (hr_schedule_assignments) --------------------- */

/**
 * Re-derive the canonical row numbers for an already-persisted punch after an
 * authorized correction. The basis is the SAME one check-in used (schedule
 * countable when the row carries a snapshot, company cutoff otherwise) and so
 * is the monthly grace/threshold rule — the row being corrected is excluded
 * from the occurrence scan and then counted once through its own new state.
 */
async function canonicalForCorrection(opts: {
  companyId: string;
  employeeId: string;
  monthKey: string;
  excludeAttendanceId: string;
  schedule: { countableLateMinutes: number; timezone: string } | null;
  checkInAt: Date;
  cutoffTime: string;
  companyTimezone?: string | null;
  lateThreshold: number;
}): Promise<{ lateMinutes: number; isLate: boolean; deductionMinutes: number }> {
  const preliminary = canonicalLateness({
    nowMs: opts.checkInAt.getTime(),
    schedule: opts.schedule,
    cutoffTime: opts.cutoffTime,
    companyTimezone: opts.companyTimezone,
    priorLateOccurrences: 0,
    lateThreshold: opts.lateThreshold,
  });
  if (!preliminary.isLate) {
    return { lateMinutes: 0, isLate: false, deductionMinutes: 0 };
  }
  const others = await countLateOccurrencesThisMonth(
    opts.companyId,
    opts.employeeId,
    opts.monthKey,
    opts.excludeAttendanceId
  );
  return {
    lateMinutes: preliminary.lateMinutes,
    isLate: true,
    deductionMinutes: others + 1 >= opts.lateThreshold ? preliminary.lateMinutes : 0,
  };
}

/** UTC calendar day of a stored Timestamp/Date/string, matching the rows' `date` convention. */
function dayKeyOf(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return "";
}

/** Approved leave covering the punch day excuses ALL of that day's delay. */
async function isDayExcusedByApprovedLeave(
  companyId: string,
  employeeId: string,
  dateIso: string
): Promise<boolean> {
  const snap = await getDocs(
    query(
      collection(db, "companies", companyId, "leave_requests"),
      where("employeeId", "==", employeeId),
      where("status", "==", "approved")
    )
  );
  return snap.docs.some((d) => {
    const start = dayKeyOf(d.data().startDate);
    const end = dayKeyOf(d.data().endDate);
    return !!start && !!end && start <= dateIso && dateIso <= end;
  });
}

/**
 * Snapshot the effective schedule for THIS punch and the calendar day it
 * belongs to. The assignment is first probed on the fallback (UTC) day, then
 * re-probed on the schedule-zone day when the two differ, so a 00:30 punch in
 * a UTC+3 zone is judged against the day the employee actually started — and
 * `punctualityForCheckIn` never sees a spurious cross-day mismatch.
 * Employees without an assignment get `schedule: null` and fall back to the
 * documented company cutoff; a resolution failure is logged by the caller and
 * degrades the SAME way — a missing schedule is never classified as late.
 * Approved leave still excuses the whole day.
 */
async function resolveScheduleSnapshotForPunch(
  companyId: string,
  employeeId: string,
  department: string | undefined,
  checkInAt: Date,
  companyTimezone?: string | null
): Promise<{ schedule: AttendanceScheduleSnapshot | null; punchDate: string; timezone: string }> {
  // The first probe day is taken in the company zone (else UTC), so an
  // unscheduled or boundary punch starts on the tenant's real calendar day
  // rather than the UTC one; the schedule's own zone still overrides below.
  const probeZone = effectivePunchTimezone(companyTimezone);
  const probeDate = zonedDayKeyOf(checkInAt.getTime(), probeZone);
  let assignment = await WorkScheduleService.resolveAssignment(
    companyId,
    employeeId,
    department,
    probeDate
  );
  let punchDate = probeDate;
  if (assignment) {
    punchDate = zonedDayKeyOf(checkInAt.getTime(), effectiveValuesOf(assignment).timezone);
    if (punchDate !== probeDate) {
      // The employee's own calendar day differs from the probe day — re-probe
      // the effective ranges with the real punch day.
      assignment = await WorkScheduleService.resolveAssignment(
        companyId,
        employeeId,
        department,
        punchDate
      );
      if (!assignment) punchDate = probeDate; // unscheduled on that day after all
    }
  }
  if (!assignment) {
    // No schedule: the effective zone is the company zone (or UTC), which the
    // caller's canonical resolution re-derives identically.
    return { schedule: null, punchDate, timezone: probeZone };
  }
  const punctuality = punctualityForCheckIn(effectiveValuesOf(assignment), checkInAt, punchDate);
  const excused = punctuality.rawLateMinutes > 0
    ? await isDayExcusedByApprovedLeave(companyId, employeeId, punchDate)
    : false;
  const excusedLateMinutes = excused ? punctuality.rawLateMinutes : 0;
  return {
    punchDate,
    timezone: punctuality.timezone,
    schedule: {
      scheduleAssignmentId: assignment.id,
      scheduledStart: punctuality.scheduledStart,
      scheduleTimezone: punctuality.timezone,
      graceMinutes: punctuality.graceMinutes,
      rawLateMinutes: punctuality.rawLateMinutes,
      excusedLateMinutes,
      countableLateMinutes: countableLateMinutes(punctuality.rawLateMinutes, excused),
      workMode: assignment.templateMode ?? null,
    },
  };
}

export const PeopleService = {
  // Company-wide lateness/deduction policy (Settings → Attendance → Late Policy).
  attendanceSettings: {
    async get(companyId: string): Promise<ApiResponse<AttendanceLatePolicy>> {
      return withLogging(SERVICE_NAME, "attendanceSettings.get", (async () => ({
        data: await getAttendanceLatePolicy(companyId),
        message: "Success",
      }))());
    },
    async update(
      companyId: string,
      patch: Partial<AttendanceLatePolicy>,
      updatedBy?: string
    ): Promise<ApiResponse<AttendanceLatePolicy>> {
      return withLogging(SERVICE_NAME, "attendanceSettings.update", (async () => {
        // A company zone, when supplied, must be a valid IANA id — never a
        // silently-truncated string, never a browser-derived guess.
        if (patch.timezone !== undefined && patch.timezone !== null && patch.timezone !== "") {
          if (!isValidTimezone(patch.timezone)) {
            return {
              data: await getAttendanceLatePolicy(companyId),
              message: "people.attendance_settings.invalid_timezone",
            };
          }
        }
        const current = await getAttendanceLatePolicy(companyId);
        const next: AttendanceLatePolicy = {
          lateCutoffTime: patch.lateCutoffTime?.trim() || current.lateCutoffTime,
          lateThreshold:
            Number.isFinite(patch.lateThreshold) && (patch.lateThreshold as number) >= 1
              ? (patch.lateThreshold as number)
              : current.lateThreshold,
          // Only touched when the caller explicitly sends it, so an unrelated
          // cutoff/threshold save never clears a configured company zone. An
          // empty string or null clears it back to the UTC fallback.
          timezone:
            patch.timezone === undefined
              ? current.timezone
              : patch.timezone && patch.timezone.trim() && isValidTimezone(patch.timezone)
                ? patch.timezone.trim()
                : null,
        };
        await setDoc(
          ATTENDANCE_SETTINGS_DOC(companyId),
          { ...next, updatedAt: serverTimestamp(), updatedBy: updatedBy ?? null },
          { merge: true }
        );
        return { data: next, message: "Attendance policy updated" };
      })());
    },
  },

  // Employee Management
  async getEmployees(
    companyId: string,
    callerScope?: {
      role?: string;
      userId?: string;
      branchId?: string;
      workLocationId?: string;
      hasCompanyWideAccess?: boolean;
      countryScope?: readonly string[] | string[] | null;
    }
  ): Promise<ApiResponse<Employee[]>> {
    return withLogging(SERVICE_NAME, "getEmployees", (async () => {
      const employeesRef = collection(db, "companies", companyId, "employees");
      const usersQuery = query(
        collection(db, "users"),
        where("companyId", "==", companyId)
      );
      const [querySnapshot, usersSnap] = await Promise.all([
        getDocs(employeesRef),
        getDocs(usersQuery),
      ]);

      const usersById = new Map<string, Record<string, unknown>>();
      const usersByEmail = new Map<string, Record<string, unknown>>();
      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data() as Record<string, unknown>;
        usersById.set(userDoc.id, userData);
        const email = String(userData.email || "")
          .trim()
          .toLowerCase();
        if (email) usersByEmail.set(email, userData);
      }

      let employees = querySnapshot.docs.map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        return enrichEmployeeFromUser(
          docSnap.id,
          { ...data, companyId: data.companyId || companyId },
          usersById,
          usersByEmail
        );
      });

      return {
        // Scope resolution:
        // A manager with people.view_all_reports can see employees across all branches and office locations
        // belonging to the same authorized company.
        // A manager without company-wide visibility must remain restricted to their authorized scope.
        ...(() => {
          let scope = callerScope ? {
            role: callerScope.role,
            userId: callerScope.userId || (callerScope as any).uid,
            branchId: callerScope.branchId,
            workLocationId: callerScope.workLocationId,
            countryScope: callerScope.countryScope,
            hasCompanyWideAccess: callerScope.hasCompanyWideAccess !== undefined
              ? callerScope.hasCompanyWideAccess
              : Boolean(
                  (callerScope as any).role === "platform_admin" ||
                  (callerScope as any).role === "admin" ||
                  (callerScope as any).role === "super_admin" ||
                  (callerScope as any).role === "global_hr_manager" ||
                  (callerScope as any).permissions?.includes("people.view_all_reports") ||
                  (callerScope as any).customPermissions?.includes("people.view_all_reports")
                ),
          } : undefined;

          if (!scope && typeof window !== "undefined") {
            try {
              const authUser = useAuthStore.getState().user;
              if (authUser && (authUser.role === "platform_admin" || authUser.role === "super_admin" || authUser.companyId === companyId)) {
                const role = authUser.role;
                const canViewAll =
                  role === "platform_admin" ||
                  role === "admin" ||
                  role === "super_admin" ||
                  role === "global_hr_manager" ||
                  hasEffectivePermission(
                    {
                      role: authUser.role,
                      portalSubRoles: authUser.portalSubRoles,
                      customPermissions: authUser.customPermissions,
                    },
                    "people.view_all_reports"
                  );
                scope = {
                  role,
                  userId: authUser.id,
                  branchId: authUser.branchId,
                  workLocationId: authUser.workLocationId,
                  countryScope: authUser.countryScope,
                  hasCompanyWideAccess: Boolean(canViewAll),
                };
              }
            } catch (scopeErr) {
              console.warn("[PeopleService:getEmployees] Failed to resolve auth caller scope", scopeErr);
            }
          }
          employees = filterEmployeesByScope(employees, scope);
          return {};
        })(),
        data: employees,
        message: "Success",
      };
    })());
  },

  async updateEmployee(companyId: string, employeeId: string, data: Partial<Employee>): Promise<ApiResponse<Employee>> {
    return withLogging(SERVICE_NAME, "updateEmployee", (async () => {
      const docRef = doc(db, "companies", companyId, "employees", employeeId);

      // Keep emails unique when one is being changed.
      const email = data.email !== undefined ? normalizeEmail(data.email) : undefined;
      if (email !== undefined) {
        if (!email) throw new Error(EMPLOYEE_EMAIL_REQUIRED);
        const { isTaken } = await lookupEmployeeEmail(companyId, email, employeeId);
        if (isTaken) throw new Error(EMPLOYEE_EMAIL_EXISTS);
      }

      await updateDoc(docRef, {
        ...data,
        ...(email !== undefined ? { email } : {}),
        updatedAt: serverTimestamp(),
      });

      const updatedDoc = await getDoc(docRef);
      return {
        data: { id: updatedDoc.id, ...updatedDoc.data() } as Employee,
        message: "Employee updated successfully",
      };
    })());
  },

  async getEmployee(companyId: string, employeeId: string): Promise<ApiResponse<Employee>> {
    return withLogging(SERVICE_NAME, "getEmployee", (async () => {
      const docRef = doc(db, "companies", companyId, "employees", employeeId);
      const snap = await getDoc(docRef);
      if (!snap.exists()) throw new Error("Employee not found");

      const data = snap.data() as Record<string, unknown>;
      const usersQuery = query(
        collection(db, "users"),
        where("companyId", "==", companyId)
      );
      const usersSnap = await getDocs(usersQuery);
      const usersById = new Map<string, Record<string, unknown>>();
      const usersByEmail = new Map<string, Record<string, unknown>>();
      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data() as Record<string, unknown>;
        usersById.set(userDoc.id, userData);
        const email = String(userData.email || "")
          .trim()
          .toLowerCase();
        if (email) usersByEmail.set(email, userData);
      }

      return {
        data: enrichEmployeeFromUser(snap.id, data, usersById, usersByEmail),
        message: "Success",
      };
    })());
  },

  // Leave Management
  async getLeaveRequests(companyId: string): Promise<ApiResponse<LeaveRequest[]>> {
    return withLogging(SERVICE_NAME, "getLeaveRequests", (async () => {
      const leaveRef = collection(db, "companies", companyId, "leave_requests");
      const querySnapshot = await getDocs(leaveRef);

      const requests = querySnapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          startDate: data.startDate instanceof Timestamp ? data.startDate.toDate().toISOString() : data.startDate,
          endDate: data.endDate instanceof Timestamp ? data.endDate.toDate().toISOString() : data.endDate,
          createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : data.createdAt,
          updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : data.updatedAt,
        } as LeaveRequest;
      });

      return {
        data: requests,
        message: "Success",
      };
    })());
  },

  async submitLeaveRequest(companyId: string, data: Omit<LeaveRequest, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<ApiResponse<LeaveRequest>> {
    return withLogging(SERVICE_NAME, "submitLeaveRequest", (async () => {
      const leaveRef = collection(db, "companies", companyId, "leave_requests");
      const docRef = await addDoc(leaveRef, {
        ...data,
        status: "pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const newDoc = await getDoc(docRef);
      return {
        data: { id: newDoc.id, ...newDoc.data() } as LeaveRequest,
        message: "Leave request submitted successfully",
      };
    })());
  },

  // Leave Management
  async updateLeaveRequestStatus(companyId: string, requestId: string, status: LeaveStatus, approvedById: string): Promise<ApiResponse<void>> {
    return withLogging(SERVICE_NAME, "updateLeaveRequestStatus", (async () => {
      const docRef = doc(db, "companies", companyId, "leave_requests", requestId);
      await updateDoc(docRef, {
        status,
        approvedById,
        updatedAt: serverTimestamp(),
      });
      return { data: undefined as void, message: `Leave request ${status} successfully` };
    })());
  },

  // Attendance & Time Tracking
  async checkIn(
    companyId: string,
    employeeId: string,
    geo?: AttendanceGeoPayload
  ): Promise<ApiResponse<Attendance>> {
    return withLogging(SERVICE_NAME, "checkIn", (async () => {
      const attendanceRef = collection(db, "companies", companyId, "attendance");
      const now = new Date();

      // ONE canonical lateness decision (see `canonicalLateness`). Order
      // matters: the effective schedule is resolved FIRST because its timezone
      // defines the punch's calendar day, the month window the late-occurrence
      // count runs in, and the lateness itself. Precedence is schedule zone →
      // the tenant's company zone → the documented UTC fallback; the browser's
      // clock is never consulted.
      const policy = await getAttendanceLatePolicy(companyId);
      const unscheduledZone = resolveEffectiveTimezone(null, policy.timezone).timezone;
      let schedule: AttendanceScheduleSnapshot | null = null;
      let punchDate = zonedDayKeyOf(now.getTime(), unscheduledZone);
      // Employment gate — read BEFORE the schedule degradation below: a
      // terminated/suspended record may not open a shift, and that failure
      // must NOT be swallowed as "no schedule, use the cutoff". The stable
      // code lets the UI explain the block instead of a generic write error.
      const employeeSnap = await getDoc(doc(db, "companies", companyId, "employees", employeeId));
      const employeeRecord = employeeSnap.data() as Employee | undefined;
      if (employeeRecord?.status && !isEmploymentActive(employeeRecord.status)) {
        throw Object.assign(new Error("Employment is not active"), { code: "employment_inactive" });
      }
      try {
        const resolved = await resolveScheduleSnapshotForPunch(
          companyId,
          employeeId,
          employeeRecord?.department,
          now,
          policy.timezone
        );
        schedule = resolved.schedule;
        punchDate = resolved.punchDate;
      } catch (e) {
        // A schedule read failure must NEVER block a check-in and must NEVER
        // classify the punch as late by itself: degrade to the cutoff fallback.
        console.warn("[checkIn] schedule resolution failed — company cutoff fallback applies", e);
        schedule = null;
      }

      const date = punchDate;
      // Pre-check on the same primitives `canonicalLateness` uses, purely to
      // skip the occurrence scan for punches that are on time (as before).
      const latenessSoFar = schedule
        ? Math.max(0, Math.round(schedule.countableLateMinutes))
        : cutoffLateMinutes(now.getTime(), policy.lateCutoffTime, unscheduledZone);
      const priorLateOccurrences =
        latenessSoFar > 0
          ? await countLateOccurrencesThisMonth(companyId, employeeId, date.slice(0, 7))
          : 0;
      const canonical = canonicalLateness({
        nowMs: now.getTime(),
        schedule: schedule
          ? { countableLateMinutes: schedule.countableLateMinutes, timezone: schedule.scheduleTimezone }
          : null,
        cutoffTime: policy.lateCutoffTime,
        companyTimezone: policy.timezone,
        priorLateOccurrences,
        lateThreshold: policy.lateThreshold,
      });
      if (canonical.usedUtcFallback) {
        // Explicit diagnostic for the last-resort case: neither a schedule nor
        // a configured company zone was available, so this punch is bucketed
        // in UTC. Tenant owners should set Settings → Attendance → company zone.
        console.warn(
          `[checkIn] no schedule/company timezone resolved — punch classified in the ${FALLBACK_TIMEZONE} fallback (employee ${employeeId})`
        );
      }
      if (canonical.punchDate !== date) {
        // Defensive: the day key comes from the same inputs as above, so a
        // divergence would mean a second clock crept back in. Never silent.
        console.warn(`[checkIn] punch day divergence (${date} vs ${canonical.punchDate})`);
      }

      const payload: Record<string, unknown> = {
        employeeId,
        date,
        attendanceTimezone: canonical.timezone,
        checkIn: serverTimestamp(),
        status: canonical.isLate ? "late" : "present",
        lateMinutes: canonical.lateMinutes,
        deductionMinutes: canonical.deductionMinutes,
        createdAt: serverTimestamp(),
        // Author's uid for the security boundary (pruned when signed out).
        userId: auth.currentUser?.uid,
      };

      // The frozen snapshot rides along as the audit trail — raw / excused /
      // countable keep their distinct meanings — but the row-level numbers
      // above now come from the SAME basis, so the alert, Timesheets, the
      // lateness report and payroll can no longer disagree about a new punch.
      // Without an assignment the company cutoff remains the documented basis.
      if (schedule) payload.schedule = schedule;
      // Optional geo facts are merged key-by-key: a flexible check-in with a
      // working GPS but no configured work locations resolves locationName to
      // undefined, and Firestore rejects explicit undefined values outright.
      Object.assign(payload, buildCheckInGeoFields(geo));

      // Idempotent retry: if a previous attempt already opened a session for
      // today (e.g. the write succeeded but the response was lost), reuse it
      // instead of creating a duplicate active attendance record.
      const todayRes = await getDocs(query(attendanceRef, where("date", "==", date)));
      const openExisting = todayRes.docs.find((d) => {
        const data = d.data();
        return data.employeeId === employeeId && isOpenSessionForDay(data, date);
      });
      if (openExisting) {
        const employeeRef = doc(db, "companies", companyId, "employees", employeeId);
        await updateDoc(employeeRef, {
          shiftStatus: "working",
          updatedAt: serverTimestamp(),
        });
        return {
          data: { id: openExisting.id, ...openExisting.data() } as Attendance,
          message: "Check-in session already active",
        };
      }

      const docRef = await addDoc(attendanceRef, pruneUndefinedFields(payload));

      // Global status update for persistence across browsers
      const employeeRef = doc(db, "companies", companyId, "employees", employeeId);
      await updateDoc(employeeRef, {
        shiftStatus: "working",
        updatedAt: serverTimestamp(),
      });

      const newDoc = await getDoc(docRef);
      return {
        data: { id: newDoc.id, ...newDoc.data() } as Attendance,
        message: "Checked in successfully",
      };
    })());
  },

  async checkOut(
    companyId: string,
    attendanceId: string,
    employeeId: string,
    nextStatus: "on-break" | "off-duty" = "off-duty",
    geo?: AttendanceGeoPayload
  ): Promise<ApiResponse<Attendance>> {
    return withLogging(SERVICE_NAME, "checkOut", (async () => {
      const docRef = doc(db, "companies", companyId, "attendance", attendanceId);
      const snap = await getDoc(docRef);
      const data = snap.data()!;

      const checkIn = data.checkIn instanceof Timestamp ? data.checkIn.toDate() : new Date(data.checkIn);
      const checkOut = new Date();
      const totalHours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);

      const update: Record<string, unknown> = {
        checkOut: serverTimestamp(),
        totalHours,
        updatedAt: serverTimestamp(),
      };
      Object.assign(update, buildCheckOutGeoFields(geo));

      await updateDoc(docRef, pruneUndefinedFields(update));

      // Global status update
      const employeeRef = doc(db, "companies", companyId, "employees", employeeId);
      await updateDoc(employeeRef, {
        shiftStatus: nextStatus,
        updatedAt: serverTimestamp(),
      });

      const updatedDoc = await getDoc(docRef);
      return {
        data: { id: updatedDoc.id, ...updatedDoc.data() } as Attendance,
        message: "Checked out successfully",
      };
    })());
  },

  async getAttendance(companyId: string, employeeId: string): Promise<ApiResponse<Attendance[]>> {
    return withLogging(SERVICE_NAME, "getAttendance", (async () => {
      const attendanceRef = collection(db, "companies", companyId, "attendance");
      const q = query(attendanceRef, where("employeeId", "==", employeeId));

      const querySnapshot = await getDocs(q);
      const records = querySnapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          checkIn: data.checkIn instanceof Timestamp ? data.checkIn.toDate().toISOString() : data.checkIn,
          checkOut: data.checkOut instanceof Timestamp ? data.checkOut.toDate().toISOString() : data.checkOut,
        } as Attendance;
      });

      return {
        data: records,
        message: "Success",
      };
    })());
  },

  async getAllAttendance(companyId: string): Promise<ApiResponse<Attendance[]>> {
    return withLogging(SERVICE_NAME, "getAllAttendance", (async () => {
      const attendanceRef = collection(db, "companies", companyId, "attendance");

      const querySnapshot = await getDocs(attendanceRef);
      const records = querySnapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          checkIn: data.checkIn instanceof Timestamp ? data.checkIn.toDate().toISOString() : data.checkIn,
          checkOut: data.checkOut instanceof Timestamp ? data.checkOut.toDate().toISOString() : data.checkOut,
        } as Attendance;
      });

      return {
        data: records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        message: "Success",
      };
    })());
  },

  /**
   * Authorized correction of an attendance row. A reason is mandatory, every
   * changed field is recorded before/after in the row's `corrections` trail,
   * and all derived values (lateness, worked hours) are RECALCULATED — never
   * hand-edited. Employees never correct their own rows: the actor being the
   * row's subject (or the linked employee's account) is refused here and at
   * the database boundary; the fine-grained role capability lives in
   * firestore.rules.
   */
  async correctAttendance(
    companyId: string,
    attendanceId: string,
    actorUid: string,
    reason: string,
    changes: {
      checkIn?: Date;
      checkOut?: Date;
      status?: Attendance["status"];
      excusedNote?: string | null;
    }
  ): Promise<ApiResponse<Attendance>> {
    return withLogging(SERVICE_NAME, "correctAttendance", (async () => {
      if (!reason || !reason.trim()) {
        return { data: null as unknown as Attendance, message: "schedules.validation.reasonRequired" };
      }
      const ref = doc(db, "companies", companyId, "attendance", attendanceId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return { data: null as unknown as Attendance, message: "Attendance row not found" };
      const row = { id: snap.id, ...snap.data() } as Attendance & { checkIn?: Timestamp | string };

      // Self-correction guard: neither the stamped author nor the employee's
      // linked account may match the actor.
      if (actorUid) {
        if (row.userId && row.userId === actorUid) {
          return { data: null as unknown as Attendance, message: "people.attendance.selfCorrectionNotAllowed" };
        }
        const empSnap = await getDoc(doc(db, "companies", companyId, "employees", row.employeeId));
        if (String((empSnap.data() as Employee | undefined)?.userId || "") === actorUid) {
          return { data: null as unknown as Attendance, message: "people.attendance.selfCorrectionNotAllowed" };
        }
      }

      const toDay = (v: unknown): Date | null =>
        v instanceof Timestamp ? v.toDate() : v ? new Date(String(v)) : null;
      const audit: Record<string, { from: unknown; to: unknown }> = {};
      const update: Record<string, unknown> = { updatedAt: serverTimestamp() };
      const entry: AttendanceCorrectionEntry = {
        at: new Date().toISOString(),
        by: actorUid,
        reason: reason.trim(),
        changes: {},
      };

      const oldIn = toDay(row.checkIn);
      const oldOut = toDay(row.checkOut);
      const newIn = changes.checkIn ?? oldIn;
      const newOut = changes.checkOut ?? oldOut;

      if (changes.checkIn && oldIn) {
        audit.checkIn = { from: oldIn.toISOString(), to: changes.checkIn.toISOString() };
        update.checkIn = Timestamp.fromDate(changes.checkIn);
      }
      if (changes.checkOut && oldOut !== (changes.checkOut ?? null)) {
        audit.checkOut = { from: oldOut ? oldOut.toISOString() : null, to: changes.checkOut.toISOString() };
        update.checkOut = Timestamp.fromDate(changes.checkOut);
      }
      if (newIn && newOut) {
        const totalHours = Math.round(((newOut.getTime() - newIn.getTime()) / 3600000) * 100) / 100;
        if (totalHours !== row.totalHours) {
          audit.totalHours = { from: row.totalHours ?? null, to: totalHours };
          update.totalHours = totalHours;
        }
      }

      if (changes.excusedNote !== undefined) {
        audit.excusedNote = { from: row.excusedNote ?? null, to: changes.excusedNote };
        update.excusedNote = changes.excusedNote;
      }

      const excusedNow =
        typeof changes.excusedNote === "string" && changes.excusedNote.trim().length > 0;

      if (row.schedule) {
        // Schedule-resolved row: recompute the lateness triple from the
        // frozen assignment's effective values (never from the mutable
        // template). Without the assignment doc the basis cannot be
        // re-derived, so punch-time edits there are refused instead of
        // guessed.
        const prev = row.schedule;
        let rawLate = prev.rawLateMinutes;
        if (changes.checkIn) {
          const aSnap = await getDoc(
            doc(db, "companies", companyId, "hr_schedule_assignments", prev.scheduleAssignmentId)
          );
          if (!aSnap.exists()) {
            return { data: null as unknown as Attendance, message: "schedules.assignmentMissingCannotRecalc" };
          }
          const assignment = {
            snapshot: aSnap.data().snapshot as ScheduleValues,
            overrides: (aSnap.data().overrides as Partial<ScheduleValues> | null) ?? null,
          } as ScheduleAssignment;
          const punctuality = punctualityForCheckIn(effectiveValuesOf(assignment), changes.checkIn, row.date);
          rawLate = punctuality.rawLateMinutes;
        }
        let excusedMin = excusedNow ? rawLate : changes.excusedNote === null || changes.excusedNote === "" ? 0 : prev.excusedLateMinutes;
        if (
          (changes.excusedNote === null || changes.excusedNote === "" || changes.checkIn) &&
          !excusedNow
        ) {
          // Un-excusing re-checks approved leave rather than assuming 0.
          const onLeave = await isDayExcusedByApprovedLeave(companyId, row.employeeId, row.date);
          excusedMin = onLeave ? rawLate : 0;
        }
        const countable = countableLateMinutes(rawLate, excusedMin > 0);
        let snapshotChanged = false;
        if (
          rawLate !== prev.rawLateMinutes ||
          excusedMin !== prev.excusedLateMinutes ||
          countable !== prev.countableLateMinutes
        ) {
          snapshotChanged = true;
          audit.schedule = { from: prev, to: { ...prev, rawLateMinutes: rawLate, excusedLateMinutes: excusedMin, countableLateMinutes: countable } };
          update.schedule = { ...prev, rawLateMinutes: rawLate, excusedLateMinutes: excusedMin, countableLateMinutes: countable };
        }
        // Canonical row numbers follow the corrected snapshot, so the alert
        // basis, Timesheets, the report and payroll stay welded to one value.
        if (snapshotChanged) {
          const policy = await getAttendanceLatePolicy(companyId);
          const derived = await canonicalForCorrection({
            companyId,
            employeeId: row.employeeId,
            monthKey: row.date.slice(0, 7),
            excludeAttendanceId: attendanceId,
            schedule: { countableLateMinutes: countable, timezone: prev.scheduleTimezone },
            checkInAt: changes.checkIn ?? oldIn ?? new Date(),
            cutoffTime: policy.lateCutoffTime,
            companyTimezone: policy.timezone,
            lateThreshold: policy.lateThreshold,
          });
          if (derived.lateMinutes !== (row.lateMinutes ?? 0)) {
            audit.lateMinutes = { from: row.lateMinutes ?? 0, to: derived.lateMinutes };
            update.lateMinutes = derived.lateMinutes;
          }
          if (derived.deductionMinutes !== (row.deductionMinutes ?? 0)) {
            audit.deductionMinutes = { from: row.deductionMinutes ?? 0, to: derived.deductionMinutes };
            update.deductionMinutes = derived.deductionMinutes;
          }
          const derivedStatus = derived.isLate ? "late" : row.status === "late" ? "present" : row.status;
          if (derivedStatus !== row.status) {
            audit.status = { from: row.status, to: derivedStatus };
            update.status = derivedStatus;
          }
        }
      } else {
        // Legacy row: the ONLY documented basis is the CURRENT company
        // cutoff — evaluated in the documented fallback zone, exactly like
        // check-in (never the browser's clock). Excusing via a note zeroes the
        // day's late/deduction minutes; un-excusing a previously excused
        // legacy row requires the corrected check-in to re-derive them.
        const policy = await getAttendanceLatePolicy(companyId);
        let lateMinutes = row.lateMinutes ?? 0;
        let deductionMinutes = row.deductionMinutes ?? 0;
        if (excusedNow) {
          lateMinutes = 0;
          deductionMinutes = 0;
        } else if (changes.checkIn && oldIn) {
          const derived = await canonicalForCorrection({
            companyId,
            employeeId: row.employeeId,
            monthKey: row.date.slice(0, 7),
            excludeAttendanceId: attendanceId,
            schedule: null,
            checkInAt: changes.checkIn,
            cutoffTime: policy.lateCutoffTime,
            companyTimezone: policy.timezone,
            lateThreshold: policy.lateThreshold,
          });
          lateMinutes = derived.lateMinutes;
          deductionMinutes = derived.deductionMinutes;
        }
        if (lateMinutes !== (row.lateMinutes ?? 0)) {
          audit.lateMinutes = { from: row.lateMinutes ?? 0, to: lateMinutes };
          update.lateMinutes = lateMinutes;
        }
        if (deductionMinutes !== (row.deductionMinutes ?? 0)) {
          audit.deductionMinutes = { from: row.deductionMinutes ?? 0, to: deductionMinutes };
          update.deductionMinutes = deductionMinutes;
        }
        const nextStatus = changes.status ?? (changes.checkIn ? (lateMinutes > 0 ? "late" : row.status === "late" ? "present" : row.status) : row.status);
        if (nextStatus !== row.status) {
          audit.status = { from: row.status, to: nextStatus };
          update.status = nextStatus;
        }
      }

      if (changes.status && changes.status !== update.status) {
        audit.status = { from: row.status, to: changes.status };
        update.status = changes.status;
      }

      if (Object.keys(audit).length === 0) {
        return { data: null as unknown as Attendance, message: "people.attendance.nothingToCorrect" };
      }
      entry.changes = audit;
      update.corrections = [...(row.corrections ?? []), entry];

      await updateDoc(ref, pruneUndefinedFields(update));

      // Corrections change the month's derived totals — refresh the still
      // UNDECIDED cases so reviewers never see a stale proposal. Approved/
      // posted history is never mutated (reversal is the official path).
      try {
        await WorkScheduleService.recalculateUndecidedCases(
          companyId,
          row.employeeId,
          row.date.slice(0, 7)
        );
      } catch (e) {
        console.warn("[correctAttendance] case recalculation failed", e);
      }

      const after = await getDoc(ref);
      return {
        data: { id: after.id, ...after.data() } as Attendance,
        message: "Attendance corrected and recalculated",
      };
    })());
  },

  // Hiring & Deletion
  /** Live validation for the hire form: duplicate email + linked account status. */
  async checkEmployeeEmail(
    companyId: string,
    email: string,
    excludeEmployeeId?: string
  ): Promise<EmployeeEmailCheck> {
    return withLogging(SERVICE_NAME, "checkEmployeeEmail", (async () => {
      const normalized = normalizeEmail(email);
      if (!normalized) return { isTaken: false, hasAccount: false, linkedUserId: "" };
      return lookupEmployeeEmail(companyId, normalized, excludeEmployeeId);
    })());
  },

  async createEmployee(companyId: string, employeeData: Omit<Employee, 'id'>): Promise<ApiResponse<Employee>> {
    return withLogging(SERVICE_NAME, "createEmployee", (async () => {
      if (!companyId || !companyId.trim()) {
        throw new Error("companyId is required: employee must belong to a company");
      }
      const email = normalizeEmail(employeeData.email);
      if (!email) throw new Error(EMPLOYEE_EMAIL_REQUIRED);

      const { isTaken, linkedUserId } = await lookupEmployeeEmail(companyId, email);
      if (isTaken) throw new Error(EMPLOYEE_EMAIL_EXISTS);

      const employeesRef = collection(db, "companies", companyId, "employees");
      const docRef = await addDoc(employeesRef, {
        ...employeeData,
        companyId: companyId.trim(),
        email,
        userId: linkedUserId || employeeData.userId || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const newDoc = await getDoc(docRef);
      return {
        data: { id: newDoc.id, ...newDoc.data() } as Employee,
        message: "Employee hired successfully",
      };
    })());
  },

  async deleteEmployee(companyId: string, employeeId: string): Promise<ApiResponse<void>> {
    return withLogging(SERVICE_NAME, "deleteEmployee", (async () => {
      const empRef = doc(db, "companies", companyId, "employees", employeeId);
      const empSnap = await getDoc(empRef);
      const empData = empSnap.exists() ? empSnap.data() : null;

      // 1. Delete employee document from company
      await deleteDoc(empRef);

      const email = empData?.email ? String(empData.email).toLowerCase().trim() : null;
      const userId = empData?.userId ? String(empData.userId).trim() : null;

      // 2. Delete user profile from Firestore users collection if userId exists
      if (userId) {
        try {
          const userDocRef = doc(db, "users", userId);
          const userSnap = await getDoc(userDocRef);
          if (userSnap.exists()) {
            await deleteDoc(userDocRef);
          }
        } catch (e) {
          console.warn(`[deleteEmployee] Failed to delete user doc for ${userId}:`, e);
        }
      }

      // 3. If email exists, delete matching user documents from users collection
      if (email) {
        try {
          const usersRef = collection(db, "users");
          const qUsers = query(usersRef, where("email", "==", email));
          const usersSnap = await getDocs(qUsers);
          for (const uDoc of usersSnap.docs) {
            await deleteDoc(uDoc.ref);
          }
        } catch (e) {
          console.warn(`[deleteEmployee] Failed to delete user by email ${email}:`, e);
        }

        // 4. Delete matching company invites and top-level invites
        try {
          const companyInvitesRef = collection(db, "companies", companyId, "invites");
          const qCompanyInvites = query(companyInvitesRef, where("email", "==", email));
          const compInvSnap = await getDocs(qCompanyInvites);
          for (const iDoc of compInvSnap.docs) {
            await deleteDoc(iDoc.ref);
          }
        } catch (e) {
          console.warn(`[deleteEmployee] Failed to delete company invites for ${email}:`, e);
        }

        try {
          const topInvitesRef = collection(db, "invites");
          const qTopInvites = query(topInvitesRef, where("email", "==", email));
          const topInvSnap = await getDocs(qTopInvites);
          for (const iDoc of topInvSnap.docs) {
            await deleteDoc(iDoc.ref);
          }
        } catch (e) {
          console.warn(`[deleteEmployee] Failed to delete top-level invites for ${email}:`, e);
        }
      }

      return {
        data: undefined,
        message: "Employee and Firebase user records deleted successfully",
      };
    })());
  },

  // Performance Reviews
  async getPerformanceReviews(companyId: string, employeeId: string): Promise<ApiResponse<PerformanceReview[]>> {
    return withLogging(SERVICE_NAME, "getPerformanceReviews", (async () => {
      const reviewsRef = collection(db, "companies", companyId, "performance_reviews");
      const q = query(reviewsRef, where("employeeId", "==", employeeId));
      const querySnapshot = await getDocs(q);

      const reviews = querySnapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          date: data.date instanceof Timestamp ? data.date.toDate().toISOString() : data.date,
        } as PerformanceReview;
      });

      return {
        data: reviews,
        message: "Success",
      };
    })());
  },

  async createPerformanceReview(companyId: string, data: Omit<PerformanceReview, 'id'>): Promise<ApiResponse<PerformanceReview>> {
    return withLogging(SERVICE_NAME, "createPerformanceReview", (async () => {
      const reviewsRef = collection(db, "companies", companyId, "performance_reviews");
      const docRef = await addDoc(reviewsRef, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const newDoc = await getDoc(docRef);
      return {
        data: { id: newDoc.id, ...newDoc.data() } as PerformanceReview,
        message: "Performance review created successfully",
      };
    })());
  },

  // Assets Management
  async getAssets(companyId: string): Promise<ApiResponse<Asset[]>> {
    return withLogging(SERVICE_NAME, "getAssets", (async () => {
      const assetsRef = collection(db, "companies", companyId, "assets");
      const querySnapshot = await getDocs(assetsRef);

      const assets = querySnapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          assignedDate: data.assignedDate instanceof Timestamp ? data.assignedDate.toDate().toISOString() : data.assignedDate,
          returnedDate: data.returnedDate instanceof Timestamp ? data.returnedDate.toDate().toISOString() : data.returnedDate,
        } as Asset;
      });

      return {
        data: assets,
        message: "Success",
      };
    })());
  },

  async createAsset(companyId: string, data: Omit<Asset, 'id'>): Promise<ApiResponse<Asset>> {
    return withLogging(SERVICE_NAME, "createAsset", (async () => {
      const assetsRef = collection(db, "companies", companyId, "assets");
      const docRef = await addDoc(assetsRef, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const newDoc = await getDoc(docRef);
      return {
        data: { id: newDoc.id, ...newDoc.data() } as Asset,
        message: "Asset created successfully",
      };
    })());
  },

  async updateAsset(companyId: string, assetId: string, data: Partial<Asset>): Promise<ApiResponse<Asset>> {
    return withLogging(SERVICE_NAME, "updateAsset", (async () => {
      const docRef = doc(db, "companies", companyId, "assets", assetId);
      await updateDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp(),
      });

      const updatedDoc = await getDoc(docRef);
      return {
        data: { id: updatedDoc.id, ...updatedDoc.data() } as Asset,
        message: "Asset updated successfully",
      };
    })());
  },

  // Announcements
  async getAnnouncements(companyId: string): Promise<ApiResponse<Announcement[]>> {
    return withLogging(SERVICE_NAME, "getAnnouncements", (async () => {
      const annRef = collection(db, "companies", companyId, "announcements");
      const querySnapshot = await getDocs(annRef);

      const announcements = querySnapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : data.createdAt,
        } as Announcement;
      });

      return {
        data: announcements.sort((a, b) => new Date(b.createdAt as Date | string).getTime() - new Date(a.createdAt as Date | string).getTime()),
        message: "Success",
      };
    })());
  },

  async createAnnouncement(companyId: string, data: Omit<Announcement, 'id'>): Promise<ApiResponse<Announcement>> {
    return withLogging(SERVICE_NAME, "createAnnouncement", (async () => {
      const annRef = collection(db, "companies", companyId, "announcements");
      const docRef = await addDoc(annRef, {
        ...data,
        createdAt: serverTimestamp(),
      });

      const newDoc = await getDoc(docRef);
      return {
        data: { id: newDoc.id, ...newDoc.data() } as Announcement,
        message: "Announcement created successfully",
      };
    })());
  },

  async getWorkLocations(companyId: string): Promise<ApiResponse<WorkLocation[]>> {
    return withLogging(SERVICE_NAME, "getWorkLocations", (async () => {
      const ref = collection(db, "companies", companyId, "work_locations");
      const snapshot = await getDocs(ref);
      const locations = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      })) as WorkLocation[];
      return {
        data: locations.sort((a, b) => a.name.localeCompare(b.name)),
        message: "Success",
      };
    })());
  },

  async createWorkLocation(
    companyId: string,
    data: CreateWorkLocationDTO
  ): Promise<ApiResponse<WorkLocation>> {
    return withLogging(SERVICE_NAME, "createWorkLocation", (async () => {
      const ref = collection(db, "companies", companyId, "work_locations");
      const docRef = await addDoc(ref, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const snap = await getDoc(docRef);
      return {
        data: { id: snap.id, ...snap.data() } as WorkLocation,
        message: "Work location created",
      };
    })());
  },

  async updateWorkLocation(
    companyId: string,
    locationId: string,
    data: Partial<CreateWorkLocationDTO>
  ): Promise<ApiResponse<WorkLocation>> {
    return withLogging(SERVICE_NAME, "updateWorkLocation", (async () => {
      const docRef = doc(db, "companies", companyId, "work_locations", locationId);
      await updateDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp(),
      });
      const snap = await getDoc(docRef);
      return {
        data: { id: snap.id, ...snap.data() } as WorkLocation,
        message: "Work location updated",
      };
    })());
  },

  async deleteWorkLocation(companyId: string, locationId: string): Promise<void> {
    return withLogging(SERVICE_NAME, "deleteWorkLocation", (async () => {
      await deleteDoc(doc(db, "companies", companyId, "work_locations", locationId));
    })());
  },
};

