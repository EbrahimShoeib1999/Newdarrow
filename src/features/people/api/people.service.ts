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
  countableLateMinutes,
  effectiveValuesOf,
  punctualityForCheckIn,
} from "../lib/work-schedule-rules";
import { WorkScheduleService } from "./work-schedule.service";

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

  return {
    id,
    ...data,
    firstName,
    lastName,
    name,
    nameAr,
    avatarUrl,
    email: String(data.email || "").trim() || userEmail,
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
  };
}

/** Minutes `checkInAt` falls past "HH:mm" on the same local day, or 0 if on time. */
function computeLateMinutes(checkInAt: Date, cutoffTime: string): number {
  const [hh, mm] = cutoffTime.split(":").map((n) => parseInt(n, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0;
  const cutoff = new Date(checkInAt);
  cutoff.setHours(hh, mm, 0, 0);
  const diffMs = checkInAt.getTime() - cutoff.getTime();
  return diffMs > 0 ? Math.round(diffMs / 60000) : 0;
}

/** How many of this employee's attendance days were already "late" so far this calendar month. */
async function countLateOccurrencesThisMonth(
  companyId: string,
  employeeId: string,
  monthKey: string // "YYYY-MM"
): Promise<number> {
  const attendanceRef = collection(db, "companies", companyId, "attendance");
  const q = query(attendanceRef, where("employeeId", "==", employeeId));
  const snapshot = await getDocs(q);
  let count = 0;
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data() as Attendance;
    if (data.status === "late" && typeof data.date === "string" && data.date.startsWith(monthKey)) {
      count += 1;
    }
  }
  return count;
}

/* --- Effective work schedule (hr_schedule_assignments) --------------------- */

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
 * Snapshot the effective schedule for THIS punch. Employees without an
 * assignment get null and the legacy company-cutoff path continues
 * untouched. Raw late minutes never round up and never exist for ambiguous
 * cross-day punches; approved leave excuses the whole day.
 */
async function resolveScheduleSnapshotForPunch(
  companyId: string,
  employeeId: string,
  department: string | undefined,
  dateIso: string,
  checkInAt: Date
): Promise<AttendanceScheduleSnapshot | null> {
  const assignment = await WorkScheduleService.resolveAssignment(
    companyId,
    employeeId,
    department,
    dateIso
  );
  if (!assignment) return null;
  const punctuality = punctualityForCheckIn(effectiveValuesOf(assignment), checkInAt, dateIso);
  const excused = punctuality.rawLateMinutes > 0
    ? await isDayExcusedByApprovedLeave(companyId, employeeId, dateIso)
    : false;
  const excusedLateMinutes = excused ? punctuality.rawLateMinutes : 0;
  return {
    scheduleAssignmentId: assignment.id,
    scheduledStart: punctuality.scheduledStart,
    scheduleTimezone: punctuality.timezone,
    graceMinutes: punctuality.graceMinutes,
    rawLateMinutes: punctuality.rawLateMinutes,
    excusedLateMinutes,
    countableLateMinutes: countableLateMinutes(punctuality.rawLateMinutes, excused),
    workMode: assignment.templateMode ?? null,
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
        const current = await getAttendanceLatePolicy(companyId);
        const next: AttendanceLatePolicy = {
          lateCutoffTime: patch.lateCutoffTime?.trim() || current.lateCutoffTime,
          lateThreshold:
            Number.isFinite(patch.lateThreshold) && (patch.lateThreshold as number) >= 1
              ? (patch.lateThreshold as number)
              : current.lateThreshold,
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
  async getEmployees(companyId: string): Promise<ApiResponse<Employee[]>> {
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

      const employees = querySnapshot.docs.map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        return enrichEmployeeFromUser(
          docSnap.id,
          data,
          usersById,
          usersByEmail
        );
      });

      return {
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
      const date = now.toISOString().split('T')[0];

      // Lateness: compare against the company's late-checkin cutoff (Settings
      // → Attendance → Late Policy). The first (threshold - 1) late check-ins
      // in a calendar month are grace; from the threshold-th one onward, each
      // is deducted (in minutes late that day).
      const policy = await getAttendanceLatePolicy(companyId);
      const lateMinutes = computeLateMinutes(now, policy.lateCutoffTime);
      let deductionMinutes = 0;
      if (lateMinutes > 0) {
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const priorLateCount = await countLateOccurrencesThisMonth(companyId, employeeId, monthKey);
        const occurrenceNumber = priorLateCount + 1; // this check-in counts too
        if (occurrenceNumber >= policy.lateThreshold) {
          deductionMinutes = lateMinutes;
        }
      }

      const payload: Record<string, unknown> = {
        employeeId,
        date,
        checkIn: serverTimestamp(),
        status: lateMinutes > 0 ? "late" : "present",
        lateMinutes,
        deductionMinutes,
        createdAt: serverTimestamp(),
        // Author's uid for the security boundary (pruned when signed out).
        userId: auth.currentUser?.uid,
      };

      // Effective-schedule snapshot (new). When an assignment resolves, the
      // punch carries its own frozen lateness basis; the legacy cutoff fields
      // above stay untouched for display/compatibility. Without an
      // assignment nothing changes at all — the company cutoff remains the
      // documented fallback. A schedule read failure must NEVER block a
      // check-in, so resolution errors degrade to the legacy behavior.
      try {
        const empSnap = await getDoc(doc(db, "companies", companyId, "employees", employeeId));
        const schedule = await resolveScheduleSnapshotForPunch(
          companyId,
          employeeId,
          (empSnap.data() as Employee | undefined)?.department,
          date,
          now
        );
        if (schedule) payload.schedule = schedule;
      } catch (e) {
        console.warn("[checkIn] schedule resolution failed — legacy cutoff policy applies", e);
      }
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
        if (
          rawLate !== prev.rawLateMinutes ||
          excusedMin !== prev.excusedLateMinutes ||
          countable !== prev.countableLateMinutes
        ) {
          audit.schedule = { from: prev, to: { ...prev, rawLateMinutes: rawLate, excusedLateMinutes: excusedMin, countableLateMinutes: countable } };
          update.schedule = { ...prev, rawLateMinutes: rawLate, excusedLateMinutes: excusedMin, countableLateMinutes: countable };
        }
        const derivedStatus = countable > 0 || rawLate > 0 ? "late" : row.status === "late" ? "present" : row.status;
        const nextStatus = changes.status ?? (rawLate !== prev.rawLateMinutes ? derivedStatus : row.status);
        if (nextStatus !== row.status) {
          audit.status = { from: row.status, to: nextStatus };
          update.status = nextStatus;
        }
      } else {
        // Legacy row: the ONLY documented basis is the CURRENT company
        // cutoff (same rule check-in used). Excusing via a note zeroes the
        // day's late/deduction minutes; un-excusing a previously excused
        // legacy row requires the corrected check-in to re-derive them.
        const policy = await getAttendanceLatePolicy(companyId);
        let lateMinutes = row.lateMinutes ?? 0;
        let deductionMinutes = row.deductionMinutes ?? 0;
        if (changes.checkIn && oldIn) {
          lateMinutes = computeLateMinutes(changes.checkIn, policy.lateCutoffTime);
          deductionMinutes = lateMinutes > 0 ? deductionMinutes : 0;
        }
        if (excusedNow) {
          lateMinutes = 0;
          deductionMinutes = 0;
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
      const email = normalizeEmail(employeeData.email);
      if (!email) throw new Error(EMPLOYEE_EMAIL_REQUIRED);

      const { isTaken, linkedUserId } = await lookupEmployeeEmail(companyId, email);
      if (isTaken) throw new Error(EMPLOYEE_EMAIL_EXISTS);

      const employeesRef = collection(db, "companies", companyId, "employees");
      const docRef = await addDoc(employeesRef, {
        ...employeeData,
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

