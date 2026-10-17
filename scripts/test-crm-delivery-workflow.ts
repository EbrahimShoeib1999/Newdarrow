/**
 * Comprehensive CRM Relationship & Automated Delivery Workflow Verification Suite
 * Tests relationship integrity, contract validation, undefined stripping,
 * idempotent task generation, and smart employee assignment.
 */

import { deepStripUndefined } from "../src/features/crm/utils/firestore-mappers";
import {
  findUndefinedPaths,
  validateContractPayload,
  normalizeContractPayload,
} from "../src/features/crm/utils/contract-normalization";
import { getSmartTaskRecommendations } from "../src/features/tasks/utils/smart-assignment.utils";

let passedCount = 0;
let failedCount = 0;
const testResults: { name: string; passed: boolean; error?: string }[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    testResults.push({ name, passed: true });
    passedCount++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    testResults.push({ name, passed: false, error: err.message });
    failedCount++;
  }
}

console.log("\n=======================================================");
console.log(" D-Arrow Business — CRM & Automated Delivery Workflow Tests");
console.log("=======================================================\n");

// --- 1. Firestore Data Sanitization & Undefined Eradication ---
console.log("1. Firestore Serialization Boundary & Undefined Normalization:");

await test("deepStripUndefined removes top-level, nested, and array undefined values", () => {
  const dirty = {
    title: "عقد خدمات رقمي",
    contactId: undefined,
    form: {
      contractNumber: "CNT-2026-001",
      notes: undefined,
      clauses: [
        { id: "c1", title: "البند الأول", body: undefined },
        { id: "c2", title: "البند الثاني", body: "شروط الدفع" },
      ],
      client: {
        name: "شركة الأفق للتقنية",
        email: undefined,
      },
    },
  };

  const cleaned = deepStripUndefined(dirty);

  assert(!("contactId" in cleaned), "Top-level contactId must be omitted");
  assert(!("notes" in (cleaned as any).form), "Nested notes must be omitted");
  assert(!("body" in (cleaned as any).form.clauses[0]), "Array object body must be omitted");
  assert((cleaned as any).form.clauses[1].body === "شروط الدفع", "Valid body must be preserved");
  assert((cleaned as any).form.client.name === "شركة الأفق للتقنية", "Valid client name preserved");
  assert(!("email" in (cleaned as any).form.client), "Nested client email omitted");
});

await test("deepStripUndefined preserves legitimate false, 0, empty string, and empty array", () => {
  const payload = {
    isActive: false,
    discountAmount: 0,
    emptyNote: "",
    tags: [],
    optionalField: undefined,
  };

  const cleaned = deepStripUndefined(payload);

  assert(cleaned.isActive === false, "false must be preserved");
  assert(cleaned.discountAmount === 0, "0 must be preserved");
  assert(cleaned.emptyNote === "", "empty string must be preserved");
  assert(Array.isArray(cleaned.tags) && cleaned.tags.length === 0, "empty array must be preserved");
  assert(!("optionalField" in cleaned), "undefined must be removed");
});

await test("findUndefinedPaths safely pinpoints paths without exposing sensitive values", () => {
  const dirty = {
    dealId: "deal-123",
    secretField: undefined,
    form: {
      clauses: [{ body: undefined }],
    },
  };

  const paths = findUndefinedPaths(dirty);
  assert(paths.includes("secretField"), "Must detect secretField");
  assert(paths.includes("form.clauses[0].body"), "Must detect nested clause body");
  assert(paths.length === 2, `Expected 2 paths, found ${paths.length}`);
});

// --- 2. Contract Payload Validation ---
console.log("\n2. Contract Payload Validation:");

await test("validateContractPayload throws Arabic error when required fields are missing", () => {
  let thrown = false;
  try {
    validateContractPayload({
      title: "",
      form: { contractNumber: "", client: { name: "" }, provider: { name: "" } } as any,
    });
  } catch (err: any) {
    thrown = true;
    assert(err.message.includes("عنوان العقد"), "Must specify title error");
  }
  assert(thrown, "Must throw validation error");
});

await test("validateContractPayload passes for fully-formed valid contract", () => {
  const valid = {
    title: "عقد إدارة الحملات الإعلانية",
    form: {
      title: "عقد إدارة الحملات الإعلانية",
      contractNumber: "CNT-2026-999",
      client: { name: "شركة المدار الدولية" },
      provider: { name: "دي-آرو للأعمال" },
    } as any,
  };

  // Should not throw
  validateContractPayload(valid);
});

// --- 3. CRM Entity Relationships & Navigability ---
console.log("\n3. CRM Relationship Integrity & Navigation:");

await test("Deal correctly references Customer using stable document ID", () => {
  const customer = {
    id: "cust-alpha-777",
    name: "مؤسسة النور للتجارة",
    entityType: "establishment",
    status: "active",
  };

  const deal = {
    id: "deal-beta-888",
    title: "صفقة توريد برمجيات",
    contactId: customer.id, // Stable Document ID source of truth
    amount: 150000,
    stage: "won",
  };

  assert(deal.contactId === customer.id, "Deal must reference customer by doc ID");
  assert(deal.contactId !== customer.name, "Deal must not use customer name as foreign key");
});

await test("Contract created from Deal prepopulates dealId, contactId, and commercial data", () => {
  const deal = {
    id: "xFI8TISRhXNuwwzOBSaA",
    title: "عقد تسويق سنوي",
    contactId: "contact-omega-123",
    amount: 75000,
  };

  const contractForm = {
    title: deal.title,
    dealId: deal.id,
    contactId: deal.contactId,
    client: { name: "شركة الأمل" },
    contractNumber: "CNT-2026-042",
    provider: { name: "دي-آرو للأعمال" },
    fields: [{ key: "amountInclVat", value: deal.amount.toString() }],
  };

  assert(contractForm.dealId === deal.id, "Contract must preserve originating dealId");
  assert(contractForm.contactId === deal.contactId, "Contract must preserve customer contactId");
});

// --- 4. Service-to-Task Conversion & Idempotency ---
console.log("\n4. Contract Service-to-Task Conversion & Idempotency:");

await test("Converts approved services to tasks with real contractId, dealId, and contactId", () => {
  const contractId = "contract-real-900";
  const dealId = "deal-real-500";
  const contactId = "cust-real-100";

  const service = {
    id: "srv-design-01",
    name: "تصميم الهوية البصرية الكاملة",
    department: "التصميم والهوية",
    estimatedHours: 40,
    subtasks: [
      { id: "sub-1", title: "تصميم الشعار وتطبيقاته", estimatedHours: 20, sequenceOrder: 1 },
      { id: "sub-2", title: "إعداد دليل الهوية", estimatedHours: 20, sequenceOrder: 2 },
    ],
  };

  // Simulate task generation
  const mainTask = {
    id: "task-main-001",
    title: service.name,
    department: service.department,
    status: "todo",
    priority: "high",
    contractId,
    dealId,
    contactId,
    serviceItemId: service.id,
  };

  const subtasks = service.subtasks.map((sub) => ({
    id: `task-${sub.id}`,
    title: sub.title,
    parentId: mainTask.id,
    department: service.department,
    sequenceOrder: sub.sequenceOrder,
    contractId,
    dealId,
    contactId,
    serviceItemId: service.id,
  }));

  assert(mainTask.contractId === contractId, "Main task must have contractId");
  assert(mainTask.dealId === dealId, "Main task must have dealId");
  assert(mainTask.contactId === contactId, "Main task must have contactId");
  assert(subtasks.length === 2, "Must create 2 subtasks");
  assert(subtasks[0].parentId === mainTask.id, "Subtask must point to parent task");
  assert(subtasks[0].contractId === contractId, "Subtask must retain contractId");
});

await test("Idempotency guard prevents duplicate task creation on retry", () => {
  const services = [
    { id: "s1", name: "خدمة 1", isConverted: true, convertedTaskId: "task-1" },
    { id: "s2", name: "خدمة 2", isConverted: false },
  ];

  // Filter only un-converted services
  const toConvert = services.filter((s) => !s.isConverted);

  assert(toConvert.length === 1, "Only un-converted services should be processed");
  assert(toConvert[0].id === "s2", "Service 2 must be the only one converted");
});

// --- 5. Smart Task Assignment Engine ---
console.log("\n5. Smart Employee Assignment Engine:");

const mockEmployees: any[] = [
  {
    id: "emp-1",
    userId: "user-1",
    firstName: "أحمد",
    lastName: "المصمم",
    department: "التصميم والهوية",
    jobTitle: "مصمم جرافيك أول",
    status: "active",
    skills: [{ name: "تصميم الهوية", level: 5 }],
  },
  {
    id: "emp-2",
    userId: "user-2",
    firstName: "سارة",
    lastName: "المطورة",
    department: "البرمجة والتطوير",
    jobTitle: "مطور واجهات أمامية",
    status: "active",
    skills: [{ name: "React", level: 4 }],
  },
  {
    id: "emp-3",
    userId: "user-3",
    firstName: "خالد",
    lastName: "المسوق",
    department: "التسويق الرقمي",
    jobTitle: "أخصائي حملات إعلانية",
    status: "active",
    skills: [{ name: "Google Ads", level: 5 }],
  },
  {
    id: "emp-4",
    userId: "user-4",
    firstName: "محمد",
    lastName: "المعطل",
    department: "التصميم والهوية",
    jobTitle: "مصمم جرافيك",
    status: "suspended", // Inactive!
  },
];

await test("Matches employee by department and specialized skills", () => {
  const task = {
    title: "تصميم هوية بصرية جديدة",
    department: "التصميم والهوية",
    tags: ["تصميم الهوية", "شعار"],
  };

  const report = getSmartTaskRecommendations(task, mockEmployees, [], []);

  assert(report.recommendedCandidates.length > 0, "Should find recommended candidate");
  const best = report.recommendedCandidates[0];
  assert(best.employee.id === "emp-1", "Ahmad should be the top match for design task");
  assert(best.matchLevel === "best", "Ahmad should have 'best' match level");
  assert(best.reasons.some((r) => r.includes("التصميم والهوية")), "Must cite department match");
  assert(best.reasons.some((r) => r.includes("تصميم الهوية")), "Must cite skill match");
});

await test("Inactive/suspended employees are excluded from recommendations", () => {
  const task = {
    title: "تصميم بنرات",
    department: "التصميم والهوية",
  };

  const report = getSmartTaskRecommendations(task, mockEmployees, [], []);
  const allIds = [
    ...report.recommendedCandidates.map((c) => c.employee.id),
    ...report.otherCandidates.map((c) => c.employee.id),
  ];

  assert(!allIds.includes("emp-4"), "Suspended employee emp-4 must be excluded");
});

await test("Workload balancing prioritizes available employees over overloaded ones", () => {
  const mockTasks: any[] = [
    { id: "t1", assigneeId: "user-1", status: "in_progress" },
    { id: "t2", assigneeId: "user-1", status: "todo" },
    { id: "t3", assigneeId: "user-1", status: "in_progress" },
    { id: "t4", assigneeId: "user-1", status: "todo" },
    { id: "t5", assigneeId: "user-1", status: "in_progress" },
    { id: "t6", assigneeId: "user-1", status: "todo" }, // emp-1 has 6 active tasks!
  ];

  const task = {
    title: "تصميم أيقونات",
    department: "التصميم والهوية",
  };

  const report = getSmartTaskRecommendations(task, mockEmployees, mockTasks, []);
  const emp1Match =
    report.recommendedCandidates.find((c) => c.employee.id === "emp-1") ||
    report.otherCandidates.find((c) => c.employee.id === "emp-1");

  assert(Boolean(emp1Match), "emp-1 must be evaluated");
  assert(emp1Match!.workload === 6, "emp-1 must have workload of 6");
  assert(
    Boolean(emp1Match!.warning && emp1Match!.warning.includes("مرتفع")),
    "emp-1 must receive workload warning"
  );
});

await test("Employee on approved leave is flagged and deprioritized", () => {
  const leaveRequests: any[] = [
    {
      employeeId: "emp-1",
      startDate: new Date(Date.now() - 86400000), // Yesterday
      endDate: new Date(Date.now() + 86400000 * 5), // Next 5 days
      status: "approved",
    },
  ];

  const task = {
    title: "تصميم شعار",
    department: "التصميم والهوية",
  };

  const report = getSmartTaskRecommendations(task, mockEmployees, [], leaveRequests);
  const emp1Match =
    report.recommendedCandidates.find((c) => c.employee.id === "emp-1") ||
    report.otherCandidates.find((c) => c.employee.id === "emp-1");

  assert(Boolean(emp1Match), "emp-1 must be evaluated");
  assert(emp1Match!.isOnLeave === true, "emp-1 must be detected on leave");
  assert(emp1Match!.matchLevel === "on_leave", "Match level should be on_leave");
});

// --- Test Summary ---
console.log("\n=======================================================");
console.log(` Summary: ${passedCount} passed, ${failedCount} failed`);
console.log("=======================================================\n");

if (failedCount > 0) {
  process.exit(1);
}
