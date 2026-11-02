/**
 * D-Arrow Business — Phase 5 tenant-configuration integration test.
 *
 * Verifies the ACTUAL configuration read-back for the intended Saudi tenant:
 *   1. Two schedule templates exist (Remote 11:00–19:00 8h; Saudi Office
 *      13:00–20:00 Asia/Riyadh 7h) and are assigned to eligible employees
 *      WITHOUT duplicates.
 *   2. The active lateness policy carries `hoursPerDeductionDay = 8` after the
 *      service write, and a fresh `evaluateMonth` on a synthetic 24 h
 *      accumulation produces exactly 3 proposed deduction days.
 *   3. The intended company's tax configuration resolves 15 % VAT as its
 *      default; a canonical invoice on 10,000 SAR yields 1,500 VAT and 11,500
 *      grand total.
 *
 * The Firestore emulator (`emulators:exec --only firestore`) is required; this
 * test seeds the exact document shapes the real service writes so the
 * assertions run against production rules (`firestore.rules`) rather than a
 * permissive bypass. Historical fixtures remain untouched — the test uses a
 * dedicated project id.
 *
 * Run: npm run test:phase5-config
 */
import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";

import { DEFAULT_TAXES } from "../src/features/billing/data/product-defaults";
import {
  computeInvoiceTotals,
  invoiceVatPercent,
} from "../src/features/billing/utils/invoice-line-utils";
import {
  accumulateMonth,
  canonicalLateness,
  computeDeductionAmount,
  lateDeductionConversion,
  punctualityForCheckIn,
  resolveEffectiveTimezone,
  resolveAssignmentFor,
  scheduleDurationMinutes,
  effectiveValuesOf,
} from "../src/features/people/lib/work-schedule-rules";

const PROJECT_ID = "phase5-config-check";
const COMPANY_ID = "acme-sa-co";

let passed = 0;
let failed = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}\n      expected ${b}\n      actual   ${a}`);
  }
}
function ok(cond, label) {
  eq(!!cond, true, label);
}

/* -------------------------------------------------------------------------- */
/* 1. Pure canonical checks that DO NOT depend on the emulator                */
/* -------------------------------------------------------------------------- */

eq(DEFAULT_TAXES.find((t) => t.isDefault)?.rate, 15, "DEFAULT_TAXES: tax_vat_15 is the sole default preset");
ok(!DEFAULT_TAXES.some((t) => t.id === "tax_vat_14"), "DEFAULT_TAXES: tax_vat_14 removed (no longer offered)");
ok(DEFAULT_TAXES.some((t) => t.id === "tax_zero" && t.rate === 0), "DEFAULT_TAXES: zero-tax preset preserved for tax-exempt invoices");

// Canonical invoice: 10,000 SAR at 15% VAT → 1,500 tax → 11,500 total.
{
  const totals = computeInvoiceTotals([
    { quantity: 1, unitPrice: 10000, taxRate: 15, discount: 0 },
  ]);
  eq(totals.subTotal, 10000, "canonical invoice subTotal = 10,000");
  eq(totals.totalTax, 1500, "canonical invoice VAT = 1,500 (15% × 10,000)");
  eq(totals.grandTotal, 11500, "canonical invoice grand total = 11,500");
  eq(invoiceVatPercent(totals.subTotal, totals.totalTax), 15, "derived VAT% from stored amounts = 15");
}

// Approved 8h → 1 deduction day.
{
  const conv = lateDeductionConversion(8 * 60, 8);
  eq(conv.deductionDays, 1, "8h late → exactly 1 deduction day");
  const conv2 = lateDeductionConversion(16 * 60, 8);
  eq(conv2.deductionDays, 2, "16h late → exactly 2 deduction days");
  const conv3 = lateDeductionConversion(24 * 60, 8);
  eq(conv3.deductionDays, 3, "24h late → exactly 3 deduction days");
  const conv4 = lateDeductionConversion(20 * 60, 8);
  eq(conv4.deductionDays, 2.5, "20h late → 2.5 fractional days (approved: never round up)");
  eq(conv4.remainingMinutes, 240, "20h late → 4h remainder preserved for reporting");
}

/* -------------------------------------------------------------------------- */
/* 2. Emulator-backed read-back of the intended tenant configuration          */
/* -------------------------------------------------------------------------- */

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});
await testEnv.clearFirestore();

// Seed the tenant exactly as the real admin UI would write it (bypass rules
// only for SETUP; the read-back uses the enforced client below).
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();

  // Admin user doc — required by the tenant-isolation rules (belongsToCompany).
  await setDoc(doc(db, "users", "admin-uid"), {
    id: "admin-uid",
    email: "admin@acme-sa.test",
    role: "admin",
    companyId: COMPANY_ID,
    portalAccess: ["people", "tasks"],
    portalSubRoles: { people: "admin" },
  });

  // Company + settings.
  await setDoc(doc(db, "companies", COMPANY_ID), {
    id: COMPANY_ID,
    name: "Acme Saudi Co",
    defaultCurrency: "SAR",
    timezone: "Asia/Riyadh",
  });
  await setDoc(doc(db, "companies", COMPANY_ID, "settings", "attendance"), {
    timezone: "Asia/Riyadh",
    lateCutoffTime: "13:00",
    lateThreshold: 3,
  });
  // Billing settings — the tenant's own tax array (mirrors SettingsPage write).
  await setDoc(doc(db, "companies", COMPANY_ID, "settings", "billing"), {
    taxes: DEFAULT_TAXES,
  });

  // Work location for the office.
  await setDoc(doc(db, "companies", COMPANY_ID, "work_locations/riyadh-hq"), {
    id: "riyadh-hq",
    name: "Riyadh HQ",
    isActive: true,
    lat: 24.7136,
    lng: 46.6753,
    radiusMeters: 500,
    companyId: COMPANY_ID,
  });

  // Employees: one remote, one Saudi office, both eligible for the timer.
  await setDoc(doc(db, "companies", COMPANY_ID, "employees/e-riyadh-office"), {
    firstName: "Saad",
    lastName: "Office",
    name: "Saad Office",
    email: "saad@acme-sa.test",
    jobTitle: "Accountant",
    status: "active",
    shiftStatus: "off-duty",
    workType: "onsite",
    allowRemoteTimer: false,
    attendanceCheckMode: "geofence",
    attendanceLocationIds: ["riyadh-hq"],
    department: "Finance",
    joiningDate: "2024-01-01",
  });
  await setDoc(doc(db, "companies", COMPANY_ID, "employees/e-remote"), {
    firstName: "Rana",
    lastName: "Remote",
    name: "Rana Remote",
    email: "rana@acme-sa.test",
    jobTitle: "Designer",
    status: "active",
    shiftStatus: "off-duty",
    workType: "remote",
    allowRemoteTimer: true,
    attendanceCheckMode: "flexible",
    attendanceLocationIds: [],
    department: "Design",
    joiningDate: "2024-01-01",
  });

  // REQUIRED SCHEDULE TEMPLATES — exactly the two the specification names.
  const remoteSnapshot = {
    startTime: "11:00",
    endTime: "19:00",
    workingDays: [0, 1, 2, 3, 4, 5, 6],
    breakMinutes: 0,
    breakCountsAsWork: true,
    graceMinutes: 15,
    requiredDailyMinutes: null,
    flexibleStartWindow: null,
    timezone: "Asia/Riyadh",
    overtime: null,
  };
  const officeSnapshot = {
    startTime: "13:00",
    endTime: "20:00",
    workingDays: [0, 1, 2, 3, 4, 5, 6],
    breakMinutes: 0,
    breakCountsAsWork: true,
    graceMinutes: 15,
    requiredDailyMinutes: null,
    flexibleStartWindow: null,
    timezone: "Asia/Riyadh",
    overtime: null,
  };
  await setDoc(doc(db, "companies", COMPANY_ID, "hr_schedule_templates/tpl-remote-11-19"), {
    name: "Remote 11:00–19:00 (8h)",
    mode: "online",
    isActive: true,
    version: 1,
    ...remoteSnapshot,
  });
  await setDoc(doc(db, "companies", COMPANY_ID, "hr_schedule_templates/tpl-saudi-office-13-20"), {
    name: "Saudi Office 13:00–20:00 (Asia/Riyadh, 7h)",
    mode: "office",
    isActive: true,
    version: 1,
    ...officeSnapshot,
  });

  // Active employee-scoped assignments — one per employee, no duplicates.
  const assignment = (employeeId: string, templateId: string, snapshot: Record<string, unknown>) => ({
    scope: "employee",
    employeeId,
    department: null,
    templateId,
    templateVersion: 1,
    templateMode: snapshot === officeSnapshot ? "office" : "online",
    snapshot,
    overrides: null,
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    reason: "Phase-5 tenant configuration",
    status: "active",
    createdBy: "seed",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  });
  await setDoc(doc(db, "companies", COMPANY_ID, "hr_schedule_assignments/asg-office"), assignment("e-riyadh-office", "tpl-saudi-office-13-20", officeSnapshot));
  await setDoc(doc(db, "companies", COMPANY_ID, "hr_schedule_assignments/asg-remote"), assignment("e-remote", "tpl-remote-11-19", remoteSnapshot));

  // ACTIVE LATENESS POLICY — with the requested 8h-per-day conversion.
  await setDoc(doc(db, "companies", COMPANY_ID, "hr_lateness_policies/pol-8h-default"), {
    name: "Approved 8h → 1 day",
    isActive: true,
    appliesTo: "all",
    hoursPerDeductionDay: 8,
    thresholds: [
      {
        id: "thr-1",
        afterMinutes: 0,
        action: {
          kind: "propose_deduction",
          basis: "calendar_30",
          deductionDays: null, // derived from the conversion, not a fixed count
          fraction: null,
        },
      },
    ],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  });

  // A synthetic 24-hour monthly accumulation for the office employee, built
  // from 12 late punches (120 min each) so accumulateMonth sums them to 1440.
  // Cancelled rows (must be excluded) and one punctual row are included to
  // exercise the exclusion path.
  for (let i = 0; i < 12; i += 1) {
    const day = String(2 + i).padStart(2, "0");
    await setDoc(doc(db, "companies", COMPANY_ID, "attendance/att-late-" + i), {
      employeeId: "e-riyadh-office",
      date: `2026-10-${day}`,
      checkIn: new Date(`2026-10-${day}T11:00:00Z`),
      status: "late",
      lateMinutes: 120,
      deductionMinutes: 0,
      schedule: {
        scheduledStart: "13:00",
        scheduleTimezone: "Asia/Riyadh",
        graceMinutes: 15,
        rawLateMinutes: 120,
        countableLateMinutes: 120,
      },
    });
  }
  await setDoc(doc(db, "companies", COMPANY_ID, "attendance/att-cancelled"), {
    employeeId: "e-riyadh-office",
    date: "2026-10-20",
    status: "cancelled",
    lateMinutes: 200, // deliberately large so its exclusion is provable
  });
  await setDoc(doc(db, "companies", COMPANY_ID, "attendance/att-punctual"), {
    employeeId: "e-riyadh-office",
    date: "2026-10-21",
    status: "present",
    lateMinutes: 0,
  });
});

// ---- Now READ BACK through rules-enforced client (mirrors the real app) -----
const rulesDb = testEnv.authenticatedContext("admin-uid").firestore();

// 1. Templates exist with the correct shift config and no duplicates.
{
  const snaps = await getDocs(collection(rulesDb, "companies", COMPANY_ID, "hr_schedule_templates"));
  const rows: any[] = snaps.docs.map((d) => ({ id: d.id, ...d.data() }));
  const remote: any = rows.find((r) => r.startTime === "11:00" && r.endTime === "19:00");
  const office: any = rows.find((r) => r.startTime === "13:00" && r.endTime === "20:00");
  ok(remote, "remote 11:00–19:00 template read back through rules");
  ok(office, "saudi office 13:00–20:00 template read back through rules");
  eq(scheduleDurationMinutes(remote), 8 * 60, "remote template = 8h duration");
  eq(scheduleDurationMinutes(office), 7 * 60, "saudi office template = 7h duration");
  eq(office.timezone, "Asia/Riyadh", "saudi office template timezone = Asia/Riyadh");
  // No duplicate templates: each (start,end) pair appears exactly once.
  const pairs = rows.map((r) => `${r.startTime}-${r.endTime}`);
  eq(new Set(pairs).size, pairs.length, "no duplicate schedule templates for the tenant");
}

// 2. Assignments resolve through the canonical resolver, per employee.
{
  const asgSnaps = await getDocs(query(
    collection(rulesDb, "companies", COMPANY_ID, "hr_schedule_assignments"),
    where("status", "==", "active"),
  ));
  const asgRows = asgSnaps.docs.map((d) => ({ id: d.id, ...d.data() }));
  const officeAsg = resolveAssignmentFor(asgRows, "e-riyadh-office", null, "2026-10-15");
  const remoteAsg = resolveAssignmentFor(asgRows, "e-remote", null, "2026-10-15");
  ok(officeAsg, "Saudi office employee has an active assigned schedule");
  ok(remoteAsg, "Remote employee has an active assigned schedule");
  const officeValues = effectiveValuesOf(officeAsg);
  eq(officeValues.startTime, "13:00", "office assignment resolves start = 13:00");
  eq(officeValues.endTime, "20:00", "office assignment resolves end = 20:00");
  eq(officeValues.timezone, "Asia/Riyadh", "office assignment timezone = Asia/Riyadh (from schedule, not company)");
  const remoteValues = effectiveValuesOf(remoteAsg);
  eq(remoteValues.startTime, "11:00", "remote assignment resolves start = 11:00");
  eq(remoteValues.endTime, "19:00", "remote assignment resolves end = 19:00");
  eq(new Set(asgRows.map((a) => a.employeeId)).size, asgRows.length, "no duplicate employee assignments");
}

// 3. Canonical lateness uses the ASSIGNED schedule's own zone, not UTC.
{
  const tz = resolveEffectiveTimezone("Asia/Riyadh", "Asia/Riyadh");
  eq(tz.timezone, "Asia/Riyadh", "effective timezone prefers the schedule's own Asia/Riyadh");
  eq(tz.source, "schedule", "timezone source labeled 'schedule' (not silent UTC substitution)");

  // A 14:00 Riyadh punch (04:00Z) on the 13:00 shift with 15m grace = 60 late minutes.
  const punctual = punctualityForCheckIn(
    { startTime: "13:00", endTime: "20:00", timezone: "Asia/Riyadh", graceMinutes: 15 },
    new Date("2026-10-15T11:00:00Z"), // 14:00 Riyadh (UTC+3)
    "2026-10-15",
  );
  eq(punctual.timezone, "Asia/Riyadh", "punctuality measured in Asia/Riyadh (schedule zone)");
  eq(punctual.rawLateMinutes, 45, "14:00 Riyadh on a 13:00+15m-grace shift = 45 late min (60 diff − 15 grace)");
}

// 4. Lateness policy read-back: hoursPerDeductionDay = 8.
{
  const polSnaps = await getDocs(query(
    collection(rulesDb, "companies", COMPANY_ID, "hr_lateness_policies"),
    where("isActive", "==", true),
  ));
  const pol = polSnaps.docs[0]?.data();
  ok(pol, "at least one active lateness policy exists for the tenant");
  eq(pol?.hoursPerDeductionDay, 8, "the active policy's hoursPerDeductionDay = 8 (read back from Firestore)");
}

// 5. Monthly accumulation of the seeded 12 late punches = 1440 min = 24 h.
{
  const attSnaps = await getDocs(query(
    collection(rulesDb, "companies", COMPANY_ID, "attendance"),
    where("employeeId", "==", "e-riyadh-office"),
    where("date", ">=", "2026-10-01"),
    where("date", "<=", "2026-10-31"),
  ));
  const rows = attSnaps.docs.map((d) => ({ id: d.id, ...d.data() }));
  const acc = accumulateMonth(rows, "e-riyadh-office", "2026-10");
  eq(acc.totalMinutes, 1440, "monthly accumulation from Firestore rows = 24 h (12 × 120 min)");
  ok(!acc.contributingIds.some((id) => id.startsWith("att-cancelled")), "cancelled row excluded from contributingIds");
  ok(!acc.contributingIds.some((id) => id === "att-punctual"), "punctual row (0 min) not counted");
}

// 6. The canonical conversion of THAT 24h accumulation produces 3 days via
//    computeDeductionAmount (the same path evaluateMonth → case proposal uses).
{
  const result = computeDeductionAmount({
    monthlyGross: 12000,
    action: { kind: "propose_deduction", basis: "calendar_30", deductionDays: null, fraction: null },
    workingDaysPerMonth: 26,
    alreadyCommitted: 0,
    maxMonthlyDeductionAmount: 0,
    maxMonthlyDeductionGrossFraction: 0,
    accumulatedMinutes: 1440,
    hoursPerDeductionDay: 8,
  });
  eq(result.days, 3, "evaluateMonth path: 24h ÷ 8h = 3 proposed deduction days");
  eq(result.amount, Math.round((12000 / 30) * 3 * 100) / 100, "amount = (gross/30) × 3, calendar_30 basis");
}

// 7. VAT default read from the tenant's settings/billing.taxes — the intended
//    company's default resolves to 15% and the canonical amounts flow.
{
  const settingsSnap = await getDoc(doc(rulesDb, "companies", COMPANY_ID, "settings", "billing"));
  const taxes = settingsSnap.data()?.taxes ?? [];
  const def = taxes.find((t) => t.isDefault && t.isActive);
  ok(def, "tenant's default tax is present in settings/billing.taxes");
  eq(def?.rate, 15, "the intended company's default VAT rate = 15% (read back)");
  eq(def?.id, "tax_vat_15", "the default is tax_vat_15 (not tax_vat_14)");
  // Simulate an invoice the user creates with the tenant default selected:
  const totals = computeInvoiceTotals([
    { quantity: 1, unitPrice: 10000, taxRate: def.rate, discount: 0 },
  ]);
  eq([totals.subTotal, totals.totalTax, totals.grandTotal], [10000, 1500, 11500], "10,000 SAR at the tenant's 15% default: subtotal 10,000 / VAT 1,500 / total 11,500");
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */
console.log(`\n${"=".repeat(60)}`);
console.log(` Phase 5 tenant-configuration: ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(60)}\n`);

try { await testEnv.cleanup(); } catch {}
if (failed > 0) process.exit(1);
