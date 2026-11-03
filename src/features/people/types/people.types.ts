import { Timestamp } from 'firebase/firestore';
import type {
  AttendanceCorrectionEntry,
  AttendanceScheduleSnapshot,
} from "./work-schedule.types";

export type EmployeeStatus = 'active' | 'onboarding' | 'suspended' | 'terminated';
export type LeaveType = 'vacation' | 'sick' | 'personal' | 'unpaid' | 'maternity' | 'paternity';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type UserRole = 'super_admin' | 'admin' | 'manager' | 'employee';

export interface ChecklistItem {
  id: string;
  task: string;
  isCompleted: boolean;
  completedAt?: Date | Timestamp | null;
}

export interface Employee {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  /** Some auto-provisioned records use a single name field. */
  name?: string;
  /** Arabic display name (often from the linked user profile). */
  nameAr?: string;
  email: string;
  avatarUrl?: string;
  jobTitle: string;
  department: string;
  role?: UserRole;
  permissions?: string[];
  managerId?: string;
  joiningDate: Date | Timestamp;
  status: EmployeeStatus;
  phoneNumber?: string;
  officeLocation?: string;
  /** Work locations this employee may check in from (Jisr-style geofence). */
  attendanceLocationIds?: string[];
  /**
   * geofence: must be inside an assigned location radius.
   * flexible: check-in allowed from anywhere (remote / field).
   */
  attendanceCheckMode?: "geofence" | "flexible";
  /** Auto-provisioned/hire marker for remote workers (read by check-in geo). */
  workType?: string;
  /** True for employees authorized to run their timer off-site. */
  allowRemoteTimer?: boolean;
  salary?: number;
  currency?: string;
  onboardingTasks?: ChecklistItem[];
  offboardingTasks?: ChecklistItem[];
  skills?: { name: string; level: number }[];
  country?: string;
  workLocationId?: string;
  branchId?: string;
  workMode?: "office" | "remote" | "field" | string;
  companyId?: string;
  requireGps?: boolean;
  mandatoryGps?: boolean;
  geofenceEnabled?: boolean;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  type: LeaveType;
  startDate: Date | Timestamp;
  endDate: Date | Timestamp;
  reason: string;
  status: LeaveStatus;
  approvedById?: string;
  createdAt: Date | Timestamp;
  updatedAt: Date | Timestamp;
}

export interface PerformanceReview {
  id: string;
  employeeId: string;
  reviewerId: string;
  date: Date | Timestamp;
  rating: number; // 1-5
  feedback: {
    strengths: string[];
    improvements: string[];
    general: string;
  };
  goals: string[];
  status: 'draft' | 'completed';
}

export interface Department {
  id: string;
  name: string;
  headId: string;
  parentDepartmentId?: string;
}

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'half-day';

export interface Attendance {
  id: string;
  employeeId: string;
  date: string; // Zoned day key "YYYY-MM-DD" in the row's effective timezone
  /**
   * The effective IANA zone this row's `date` was derived in (schedule zone →
   * company zone → UTC fallback). Stamped on NEW check-ins so the store's
   * "is today" restore, Timesheets bucketing and the profile window all agree
   * with what was persisted without re-resolving the schedule. Legacy rows
   * simply omit it and keep their prior UTC-day semantics (never backfilled).
   */
  attendanceTimezone?: string;
  checkIn: string | Timestamp; // ISO Date or Firebase Timestamp
  checkOut?: string | Timestamp;
  status: AttendanceStatus;
  totalHours?: number;
  location?: string;
  notes?: string;
  checkInLat?: number;
  checkInLng?: number;
  checkInLocationId?: string;
  checkInLocationName?: string;
  checkInDistanceMeters?: number;
  checkOutLat?: number;
  checkOutLng?: number;
  checkOutLocationId?: string;
  checkOutLocationName?: string;
  checkOutDistanceMeters?: number;
  hasDailyReport?: boolean;
  dailyReportId?: string;
  skippedReport?: boolean;
  /**
   * Canonical lateness minutes for this punch: the frozen schedule's countable
   * lateness when an assignment resolved, otherwise minutes past the company's
   * late-checkin cutoff. 0/absent when on time. The alert, Timesheets, the
   * lateness report and payroll all read this one value.
   */
  lateMinutes?: number;
  /**
   * Minutes deducted for this day's lateness. Only set once the employee has
   * used up their grace occurrences for the month (see AttendanceLatePolicy).
   */
  deductionMinutes?: number;
  /**
   * Author's uid, stamped on NEW check-ins so the security boundary can
   * resolve "my own attendance" without reading the employee doc. Legacy
   * rows simply don't carry it (never backfilled silently).
   */
  userId?: string;
  /**
   * Effective-schedule snapshot taken at check-in (schedule-resolved rows
   * only). Historical rows without it keep their legacy cutoff semantics.
   */
  schedule?: AttendanceScheduleSnapshot | null;
  /** Authorized corrections — reason + full before/after trail required. */
  corrections?: AttendanceCorrectionEntry[];
  /** Excusing note applied by an authorized corrector. */
  excusedNote?: string | null;
}

/**
 * Company-wide lateness policy (admin-configurable, Settings → Attendance →
 * Late Policy). The first `lateThreshold - 1` late check-ins in a calendar
 * month are grace — no deduction. From the `lateThreshold`-th late check-in
 * of the month onward, each one is deducted (in minutes late that day).
 * The cutoff is the documented FALLBACK basis: it is only consulted for
 * punches with no effective schedule. Employees with an assigned shift are
 * judged by that shift (start + grace) in the schedule's own timezone.
 */
export interface AttendanceLatePolicy {
  /** 24h "HH:mm", evaluated in the punch's effective timezone (never the browser's). */
  lateCutoffTime: string;
  /** How many late check-ins in a month before deductions start. */
  lateThreshold: number;
  /**
   * Tenant-configured company IANA zone (Settings → Attendance → Late Policy).
   * Second in the timezone precedence chain: a valid assigned schedule zone
   * wins, else this zone, else the documented UTC fallback (never browser-
   * local). Left UNSET by default so existing tenants keep their current UTC
   * behavior until an admin explicitly picks a zone — the setting is never
   * silently overwritten. A stored value is only honored when it is a valid
   * IANA id (validated on read and write).
   */
  timezone?: string | null;
  requireGps?: boolean;
  mandatoryGps?: boolean;
  geofenceEnabled?: boolean;
  updatedAt?: Date | Timestamp;
  updatedBy?: string;
}

export const DEFAULT_ATTENDANCE_LATE_POLICY: AttendanceLatePolicy = {
  lateCutoffTime: "11:30",
  lateThreshold: 3,
  // No company zone by default: unscheduled punches keep the UTC fallback
  // until an admin configures one, so enabling this feature changes nothing
  // for tenants that opt out.
  timezone: null,
};

export type AttendanceCheckMode = "geofence" | "flexible";

export interface WorkLocation {
  id: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  /** Allowed distance from the pin, in meters (Jisr default is typically 100–200). */
  radiusMeters: number;
  isActive: boolean;
  geofenceEnabled?: boolean;
  requireGps?: boolean;
  createdAt?: Date | Timestamp | string;
  updatedAt?: Date | Timestamp | string;
}

export type CreateWorkLocationDTO = Omit<WorkLocation, "id" | "createdAt" | "updatedAt">;

export interface AttendanceGeoPayload {
  lat?: number;
  lng?: number;
  accuracyMeters?: number;
  locationId?: string;
  locationName?: string;
  distanceMeters?: number;
}

export interface Asset {
  id: string;
  name: string;
  serialNumber: string;
  category: 'laptop' | 'phone' | 'accessory' | 'other';
  assignedTo: string; // employeeId
  status: 'assigned' | 'returned' | 'repair' | 'lost';
  assignedDate: Date | Timestamp;
  returnedDate?: Date | Timestamp | null;
  notes?: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  authorId: string;
  createdAt: Date | Timestamp;
  priority: 'low' | 'medium' | 'high';
}
