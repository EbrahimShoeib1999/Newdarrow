import { create } from "zustand";
import { PeopleService } from "@/features/people/api/people.service";
import type { Attendance } from "@/features/people/types/people.types";
import { toast } from "sonner";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  type DocumentData,
  type DocumentSnapshot,
} from "firebase/firestore";
import { useAuthStore } from "./auth.store";
import { AttendanceNotificationService } from "@/features/people/api/attendance-notifications.service";
import {
  FALLBACK_TIMEZONE,
  zonedDayKeyOf,
} from "@/features/people/lib/work-schedule-rules";
import { captureAttendanceGeo } from "@/features/people/utils/attendance-geo-check";
import {
  AttendanceGeoError,
  classifyAttendanceError,
  resolveCheckInBlockReason,
  type CheckInBlockCode,
} from "@/features/people/utils/geo";
import i18n from "@/lib/i18n";

const at = (key: string, opts?: Record<string, unknown>) =>
  i18n.t(key, { ns: "people", ...opts });

function geoErrorToast(error: unknown, fallbackKey: "checkin_failed" | "checkout_failed"): string {
  if (error instanceof AttendanceGeoError && error.code === "outside") {
    return at("attendance_toast.outside_location", {
      name: error.extra?.locationName ?? "",
      distance: error.extra?.distanceMeters ?? "—",
      radius: error.extra?.radiusMeters ?? "—",
    });
  }
  // Auth faults, authorization faults and payload/write failures each get their
  // own message so a check-in problem is never misread as a login problem.
  const keyByClass: Record<ReturnType<typeof classifyAttendanceError>, string> = {
    gps_denied: "gps_denied",
    gps_unavailable: "gps_unavailable",
    location_not_assigned: "location_not_assigned",
    location_inactive: "location_inactive",
    employment_inactive: "employment_inactive",
    outside: "outside_location",
    session_expired: "session_expired",
    action_forbidden: "action_forbidden",
    network_unavailable: "network_unavailable",
    write_failed: fallbackKey,
  };
  return at(`attendance_toast.${keyByClass[classifyAttendanceError(error)]}`);
}

interface AttendanceState {
  liveSeconds: number;
  accumulatedSeconds: number;
  isOnBreak: boolean;
  isShiftLoading: boolean;
  todayAttendance: Attendance | null;
  intervalId: number | null;
  employeeId: string | null;
  isInitialized: boolean;
  startTime: number | null; // For precise drift-free calculation
  isReportModalOpen: boolean;
  lateCheckInAlert: { minutes: number; deducted: boolean } | null;
  // A genuine initialization failure (permission-denied, transient network, or
  // an under-provisioned account) is surfaced here so the timer can offer a
  // recoverable retry instead of silently rendering "off-duty" forever.
  syncError: string | null;
  // Why a start would be blocked for THIS employee, computed during sync from
  // their actual employment configuration — the timer explains the block
  // instead of silently hiding or disabling the control. null = can start.
  checkInBlockReason: CheckInBlockCode | null;
  lastSync: { companyId: string; userId: string } | null;
  
  setReportModalOpen: (open: boolean) => void;
  dismissLateCheckInAlert: () => void;
  startTimer: () => void;
  stopTimer: () => void;
  cancelSync: () => void;
  retrySync: () => Promise<void>;
  
  checkIn: (companyId: string, employeeId: string, userId: string) => Promise<void>;
  takeBreak: (companyId: string, attendanceId: string, employeeId: string, userId: string) => Promise<void>;
  checkOut: (companyId: string, attendanceId: string, employeeId: string, userId: string) => Promise<void>;
  syncWithDb: (companyId: string, userId: string, force?: boolean) => Promise<void>;
}

let syncGeneration = 0;
let activeSyncKey: string | null = null;
let activeSyncPromise: Promise<void> | null = null;

export const useAttendanceStore = create<AttendanceState>((set, get) => ({
  liveSeconds: 0,
  accumulatedSeconds: 0,
  isOnBreak: false,
  isShiftLoading: false,
  todayAttendance: null,
  intervalId: null,
  employeeId: null,
  isInitialized: false,
  startTime: null,
  isReportModalOpen: false,
  lateCheckInAlert: null,
  syncError: null,
  checkInBlockReason: null,
  lastSync: null,

  setReportModalOpen: (open: boolean) => set({ isReportModalOpen: open }),
  dismissLateCheckInAlert: () => set({ lateCheckInAlert: null }),

  retrySync: async () => {
    const last = get().lastSync;
    if (!last) return;
    set({ syncError: null });
    await get().syncWithDb(last.companyId, last.userId, true);
  },

  startTimer: () => {
    if (get().intervalId) return;
    
    const tick = () => {
      const { todayAttendance } = get();
      if (!todayAttendance) return;
      
      const checkInTime = todayAttendance.checkIn instanceof Date 
        ? todayAttendance.checkIn 
        : new Date(todayAttendance.checkIn as string);
      
      const now = new Date().getTime();
      const elapsed = Math.floor((now - checkInTime.getTime()) / 1000);
      
      // Only update if value changed to minimize re-renders
      if (get().liveSeconds !== elapsed) {
        set({ liveSeconds: elapsed > 0 ? elapsed : 0 });
      }
    };

    tick(); // Initial tick
    const id = setInterval(tick, 1000);
    set({ intervalId: id });
  },

  stopTimer: () => {
    const id = get().intervalId;
    if (id) {
      clearInterval(id);
      set({ intervalId: null });
    }
  },

  cancelSync: () => {
    syncGeneration += 1;
    activeSyncKey = null;
    activeSyncPromise = null;
    get().stopTimer();
    set({
      liveSeconds: 0,
      accumulatedSeconds: 0,
      isOnBreak: false,
      isShiftLoading: false,
      todayAttendance: null,
      employeeId: null,
      isInitialized: false,
      startTime: null,
      syncError: null,
      checkInBlockReason: null,
      lastSync: null,
    });
  },

  checkIn: async (companyId, employeeId, userId) => {
    let finalEmployeeId = employeeId || get().employeeId;
    if (!companyId || !finalEmployeeId) {
      await get().syncWithDb(companyId, userId, true);
      finalEmployeeId = get().employeeId;
      if (!finalEmployeeId) {
        // Never fail silently: a click that cannot be honored (session still
        // restoring, or the sync itself failed) must surface as an explicit
        // error, not a no-op that looks like a broken button.
        console.error(
          "[AttendanceStore] Check-in aborted: no employee record resolved."
        );
        toast.error(at("attendance_toast.checkin_failed"));
        set({ isInitialized: true, syncError: get().syncError ?? "sync-failed" });
        return;
      }
    }
    
    set({ isShiftLoading: true });
    try {
      const wasOnBreak = get().isOnBreak;
      const geo = await captureAttendanceGeo(companyId, finalEmployeeId);
      const res = await PeopleService.checkIn(companyId, finalEmployeeId, geo);
      set({ 
        isOnBreak: false, 
        todayAttendance: res.data,
        liveSeconds: 0 
      });
      get().startTimer();
      await get().syncWithDb(companyId, userId, true);
      toast.success(at("attendance_toast.shift_started"));

      const lateMinutes = res.data.lateMinutes ?? 0;
      const deductionMinutes = res.data.deductionMinutes ?? 0;
      if (lateMinutes > 0) {
        set({ lateCheckInAlert: { minutes: lateMinutes, deducted: deductionMinutes > 0 } });
      }

      const authUser = useAuthStore.getState().user;
      if (authUser) {
        if (wasOnBreak) {
          AttendanceNotificationService.notifyWorkResumed(companyId, authUser.name, finalEmployeeId);
        } else {
          AttendanceNotificationService.notifyWorkStarted(companyId, authUser.name, finalEmployeeId);
        }
      }
    } catch (error) {
      console.error("Check-in error:", error);
      toast.error(geoErrorToast(error, "checkin_failed"));
    } finally {
      set({ isShiftLoading: false });
    }
  },

  takeBreak: async (companyId, attendanceId, employeeId, userId) => {
    const finalEmployeeId = employeeId || get().employeeId;
    if (!companyId || !finalEmployeeId || !attendanceId) return;
    set({ isShiftLoading: true });
    try {
      await PeopleService.checkOut(companyId, attendanceId, finalEmployeeId, "on-break");
      get().stopTimer();
      await get().syncWithDb(companyId, userId, true);
      toast.success(at("attendance_toast.break_started"));
    } catch {
      toast.error(at("attendance_toast.break_failed"));
    } finally {
      set({ isShiftLoading: false });
    }
  },

  checkOut: async (companyId, attendanceId, employeeId, userId) => {
    const finalEmployeeId = employeeId || get().employeeId;
    if (!companyId || !finalEmployeeId || !attendanceId) return;
    set({ isShiftLoading: true });
    try {
      const totalSeconds = get().accumulatedSeconds + get().liveSeconds;
      const geo = await captureAttendanceGeo(companyId, finalEmployeeId);
      await PeopleService.checkOut(
        companyId,
        attendanceId,
        finalEmployeeId,
        "off-duty",
        geo
      );
      get().stopTimer();
      await get().syncWithDb(companyId, userId, true);
      toast.success(at("attendance_toast.shift_completed"));

      const authUser = useAuthStore.getState().user;
      if (authUser) {
        AttendanceNotificationService.notifyShiftCompleted(companyId, authUser.name, totalSeconds, finalEmployeeId);
      }
    } catch (error) {
      toast.error(geoErrorToast(error, "checkout_failed"));
    } finally {
      set({ isShiftLoading: false });
    }
  },

  syncWithDb: async (companyId, userId, force = false) => {
    if (!companyId || !userId) {
      return;
    }
    const key = `${companyId}:${userId}`;
    const currentAuthUser = useAuthStore.getState().user;
    if (
      auth.currentUser?.uid !== userId ||
      !currentAuthUser ||
      currentAuthUser.id !== userId ||
      currentAuthUser.companyId !== companyId ||
      currentAuthUser.profileMissing ||
      currentAuthUser.onboardingStatus === "pending"
    ) {
      return;
    }
    if (activeSyncKey === key && activeSyncPromise) return activeSyncPromise;
    if (
      activeSyncKey === key &&
      get().lastSync?.companyId === companyId &&
      get().lastSync?.userId === userId &&
      get().isInitialized &&
      !force &&
      !get().syncError
    ) {
      return;
    }

    const generation = ++syncGeneration;
    activeSyncKey = key;
    let finishActiveSync!: () => void;
    activeSyncPromise = new Promise<void>((resolve) => {
      finishActiveSync = resolve;
    });
    const thisSyncPromise = activeSyncPromise;
    get().stopTimer();
    set({
      liveSeconds: 0,
      accumulatedSeconds: 0,
      isOnBreak: false,
      todayAttendance: null,
      employeeId: null,
      isInitialized: false,
      syncError: null,
      checkInBlockReason: null,
      lastSync: { companyId, userId },
    });
    const isCurrent = () => {
      const activeUser = useAuthStore.getState().user;
      return (
        generation === syncGeneration &&
        activeSyncKey === key &&
        auth.currentUser?.uid === userId &&
        activeUser?.id === userId &&
        activeUser.companyId === companyId &&
        !activeUser.profileMissing &&
        activeUser.onboardingStatus !== "pending"
      );
    };

    try {
      const employeesRef = collection(db, "companies", companyId, "employees");
      const authUser = useAuthStore.getState().user;
      const authEmail = authUser?.email?.trim().toLowerCase() || "";

      let employeeDoc: DocumentSnapshot<DocumentData> | undefined = (
        await getDocs(query(employeesRef, where("userId", "==", userId)))
      ).docs[0];
      if (!isCurrent()) return;

      if (!employeeDoc) {
        if (!employeeDoc && authEmail) {
          const byEmail = await getDocs(
            query(employeesRef, where("email", "==", authEmail))
          );
          if (!isCurrent()) return;
          if (byEmail.size > 1) throw new Error("EMPLOYEE_PROFILE_AMBIGUOUS");
          employeeDoc = byEmail.docs[0];
        }
      }

      if (!employeeDoc) {
        if (isCurrent()) {
          set({
            isInitialized: true,
            syncError: "employee-profile-missing",
          });
        }
        return;
      }

      const employeeData = employeeDoc.data() ?? {};
      const employeeEmail =
        typeof employeeData.email === "string"
          ? employeeData.email.trim().toLowerCase()
          : "";
      if (
        employeeData.companyId !== companyId ||
        employeeEmail !== authEmail ||
        (employeeData.userId && employeeData.userId !== userId) ||
        (employeeData.role && employeeData.role !== authUser?.role)
      ) {
        throw new Error("EMPLOYEE_PROFILE_MISMATCH");
      }

      const employeeId = employeeDoc.id;
      if (isCurrent()) set({ employeeId });

      // Pre-click explanation of a blocked start (employment status, missing
      // schedule locations). Dangling/inactive location references need the
      // company's work-location list; reading it is best-effort — when it
      // fails the click path still reports the actionable error itself.
      const readiness = resolveCheckInBlockReason(
        employeeData as Parameters<typeof resolveCheckInBlockReason>[0],
        null
      );
      let checkInBlockReason: CheckInBlockCode | null = readiness;
      if (
        !readiness &&
        employeeData.attendanceCheckMode !== "flexible" &&
        employeeData.workType !== "remote" &&
        employeeData.allowRemoteTimer !== true &&
        (employeeData.attendanceLocationIds ?? []).length > 0
      ) {
        try {
          const locRes = await PeopleService.getWorkLocations(companyId);
          if (!isCurrent()) return;
          checkInBlockReason = resolveCheckInBlockReason(
            employeeData as Parameters<typeof resolveCheckInBlockReason>[0],
            locRes.data
          );
        } catch {
          /* readiness unknown — never blocks, the punch path reports it */
        }
      }
      if (!isCurrent()) return;
      set({ checkInBlockReason });

      const res = await PeopleService.getAttendance(companyId, employeeId);
      if (!isCurrent()) return;
      // A row's `date` is its punch day IN ITS OWN EFFECTIVE ZONE (the
      // schedule's zone, else the company zone, else the documented fallback),
      // so "today" is judged per row rather than by the browser's clock. A
      // UTC+3 shift opened at 00:30 local would otherwise stop restoring after
      // a refresh while the UTC day is still yesterday. The row's own stamped
      // `attendanceTimezone` is the authoritative zone; rows without it (and
      // legacy snapshots) keep their prior semantics exactly.
      const nowMs = Date.now();
      const isCurrentDayRow = (a: Attendance): boolean =>
        typeof a.date === "string" &&
        a.date ===
          zonedDayKeyOf(nowMs, a.attendanceTimezone ?? a.schedule?.scheduleTimezone ?? FALLBACK_TIMEZONE);

      const isGlobalOnBreak = employeeData.shiftStatus === "on-break";
      const finishedToday = res.data.filter((a) => isCurrentDayRow(a) && a.checkOut);
      const totalAccumulated = finishedToday.reduce((acc: number, curr) => acc + (curr.totalHours || 0), 0);
      const activeRecord = res.data.find((a) => isCurrentDayRow(a) && !a.checkOut);
      if (!isCurrent()) return;
      set({
        isInitialized: true,
        isOnBreak: isGlobalOnBreak,
        accumulatedSeconds: Math.floor(totalAccumulated * 3600),
        todayAttendance: activeRecord && !isGlobalOnBreak ? activeRecord : null,
        liveSeconds: 0,
      });
      if (activeRecord && !isGlobalOnBreak) {
        get().startTimer();
      } else {
        get().stopTimer();
      }
    } catch (error) {
      if (!isCurrent()) return;
      // Distinguish a failed load from a legitimately empty shift: mark
      // initialization complete (so the spinner ends) and expose a recoverable
      // error rather than leaving the timer silently stuck "off-duty".
      const isPermissionDenied =
        error && typeof error === "object" && "code" in error &&
        (error as { code?: string }).code === "permission-denied";
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : error instanceof Error
            ? error.message
            : "unknown";
      console.error("[AttendanceStore] Sync failed", { code });
      set({
        isInitialized: true,
        syncError: isPermissionDenied ? "permission-denied" : "sync-failed",
      });
    } finally {
      finishActiveSync();
      if (activeSyncPromise === thisSyncPromise) activeSyncPromise = null;
    }
  }
}));
