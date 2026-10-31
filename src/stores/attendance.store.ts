import { create } from "zustand";
import { PeopleService } from "@/features/people/api/people.service";
import type { Attendance } from "@/features/people/types/people.types";
import { toast } from "sonner";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  serverTimestamp,
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
import { AttendanceGeoError, classifyAttendanceError } from "@/features/people/utils/geo";
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
  lastSync: { companyId: string; userId: string } | null;
  
  setReportModalOpen: (open: boolean) => void;
  dismissLateCheckInAlert: () => void;
  startTimer: () => void;
  stopTimer: () => void;
  retrySync: () => Promise<void>;
  
  checkIn: (companyId: string, employeeId: string, userId: string) => Promise<void>;
  takeBreak: (companyId: string, attendanceId: string, employeeId: string, userId: string) => Promise<void>;
  checkOut: (companyId: string, attendanceId: string, employeeId: string, userId: string) => Promise<void>;
  syncWithDb: (companyId: string, userId: string) => Promise<void>;
}

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
  lastSync: null,

  setReportModalOpen: (open: boolean) => set({ isReportModalOpen: open }),
  dismissLateCheckInAlert: () => set({ lateCheckInAlert: null }),

  retrySync: async () => {
    const last = get().lastSync;
    if (!last) return;
    set({ syncError: null });
    await get().syncWithDb(last.companyId, last.userId);
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

  checkIn: async (companyId, employeeId, userId) => {
    let finalEmployeeId = employeeId || get().employeeId;
    if (!companyId || !finalEmployeeId) {
      await get().syncWithDb(companyId, userId);
      finalEmployeeId = get().employeeId;
      if (!finalEmployeeId) {
        // Never fail silently: a click that cannot be honored (session still
        // restoring, or the sync itself failed) must surface as an explicit
        // error, not a no-op that looks like a broken button.
        console.error("[AttendanceStore] Check-in aborted: no employee record resolved", { companyId, userId });
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
      await get().syncWithDb(companyId, userId);
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
      await get().syncWithDb(companyId, userId);
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
      await get().syncWithDb(companyId, userId);
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

  syncWithDb: async (companyId, userId) => {
    if (!companyId || !userId) {
      // Nothing to sync against (signed out). Resolve loading so the UI never
      // hangs on a spinner; the timer simply shows an idle, non-actionable state.
      set({ isInitialized: true, syncError: null });
      return;
    }
    // Remember the arguments so a failed sync stays retryable from the widget.
    set({ lastSync: { companyId, userId }, syncError: null });
    try {
      const employeesRef = collection(db, "companies", companyId, "employees");
      const authUser = useAuthStore.getState().user;
      const authEmail = authUser?.email?.trim().toLowerCase() || "";

      let employeeDoc: DocumentSnapshot<DocumentData> | undefined = (
        await getDocs(query(employeesRef, where("userId", "==", userId)))
      ).docs[0];

      if (!employeeDoc) {
        const allEmpSnap = await getDocs(employeesRef);
        employeeDoc = allEmpSnap.docs.find((d) => d.data().userId === userId);

        // The hire flow creates the employee record before the person ever signs
        // in, and it carries no userId yet. Whichever provider they use (Google
        // included), their record is claimed by email instead of creating a
        // second one that would split their attendance in two.
        if (!employeeDoc && authEmail) {
          const byEmail = allEmpSnap.docs.find(
            (d) => String(d.data().email ?? "").trim().toLowerCase() === authEmail
          );
          if (byEmail) {
            const existing = byEmail.data();
            const hasName = Boolean(existing.name || existing.firstName || existing.lastName);
            await updateDoc(byEmail.ref, {
              userId,
              ...(hasName || !authUser?.name ? {} : { name: authUser.name }),
              updatedAt: serverTimestamp(),
            });
            employeeDoc = byEmail;
          }
        }
      }

      if (!employeeDoc) {
        if (!authUser) {
          set({ isInitialized: true });
          return;
        }
        const newEmpDoc = await addDoc(employeesRef, {
          userId,
          name: authUser.name,
          email: authEmail || authUser.email,
          role: authUser.role || "employee",
          department: "General",
          shiftStatus: "off-duty",
          workType: "remote",
          attendanceCheckMode: "flexible",
          autoStartTimer: true,
          allowRemoteTimer: true,
          joiningDate: new Date().toISOString(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        employeeDoc = await getDoc(newEmpDoc);
      }

      const employeeId = employeeDoc.id;
      const employeeData = employeeDoc.data() ?? {};
      set({ employeeId, isInitialized: true });

      const res = await PeopleService.getAttendance(companyId, employeeId);
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
      set({ isOnBreak: isGlobalOnBreak });

      const finishedToday = res.data.filter((a) => isCurrentDayRow(a) && a.checkOut);
      const totalAccumulated = finishedToday.reduce((acc: number, curr) => acc + (curr.totalHours || 0), 0);
      set({ accumulatedSeconds: Math.floor(totalAccumulated * 3600) });

      const activeRecord = res.data.find((a) => isCurrentDayRow(a) && !a.checkOut);
      if (activeRecord && !isGlobalOnBreak) {
        set({ todayAttendance: activeRecord });
        get().startTimer();
      } else {
        set({ todayAttendance: null, liveSeconds: 0 });
        get().stopTimer();
      }
    } catch (error) {
      console.error("[AttendanceStore] Sync Error:", error);
      // Distinguish a failed load from a legitimately empty shift: mark
      // initialization complete (so the spinner ends) and expose a recoverable
      // error rather than leaving the timer silently stuck "off-duty".
      const isPermissionDenied =
        error && typeof error === "object" && "code" in error &&
        (error as { code?: string }).code === "permission-denied";
      set({
        isInitialized: true,
        syncError: isPermissionDenied ? "permission-denied" : "sync-failed",
      });
    }
  }
}));
