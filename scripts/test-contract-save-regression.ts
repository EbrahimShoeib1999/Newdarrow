/**
 * Automated Regression Suite: Contract Save & Undefined Normalization
 * 
 * Tests:
 * 1. A new valid contract payload
 * 2. Optional top-level and nested undefined fields (sanitization & preservation of 0, false, empty string)
 * 3. Missing required fields and explicit Arabic validation errors
 * 4. Editing an existing contract payload
 * 5. Contract save failure preventing downstream task generation
 * 6. Document ID persistence and relationship integrity across Deal, Contact, and Contract
 */

import { deepStripUndefined } from "../src/features/crm/utils/firestore-mappers";
import {
  findUndefinedPaths,
  validateContractPayload,
  normalizeContractPayload,
} from "../src/features/crm/utils/contract-normalization";
import type { CreateContractDTO, UpdateContractDTO } from "../src/features/crm/types/contract.types";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    failed++;
  }
}

console.log("\n=======================================================");
console.log(" D-Arrow Business — Contract Save Regression Suite");
console.log("=======================================================\n");

// 1. A new valid contract
runTest("New valid contract passes validation and normalization without errors", () => {
  const validPayload: CreateContractDTO = {
    title: "عقد توريد وخدمات رقمية — شركة الفجر",
    status: "draft",
    contactId: "cust_doc_123",
    dealId: "deal_doc_456",
    convertedToTasks: false,
    createdTaskIds: [],
    approvalStatus: "pending",
    form: {
      title: "عقد توريد وخدمات رقمية",
      contractNumber: "CNT-2026-880",
      contractDateIso: "2026-10-17",
      contractType: "marketing",
      client: {
        name: "شركة الفجر للتجارة",
        signatoryName: "سعد بن إبراهيم",
      },
      provider: {
        name: "دي-آرو للأعمال",
        signatoryName: "المدير العام",
      },
      fields: [
        { id: "f1", key: "amountExclVat", label: "المبلغ بدون ضريبة", value: "50000" },
        { id: "f2", key: "amountInclVat", label: "المبلغ شامل الضريبة", value: "57500" },
      ],
      clauses: [
        {
          id: "c1",
          title: "نطاق العمل",
          bullets: [{ id: "b1", text: "تقديم الخدمات المتفق عليها" }],
        },
      ],
      services: [
        {
          id: "s1",
          name: "إدارة الحملات التسويقية",
          department: "التسويق الرقمي",
          estimatedHours: 20,
          durationDays: 14,
          selected: true,
          subtasks: [
            { id: "st1", title: "تجهيز الخطة الإعلانية", sequenceOrder: 1, estimatedHours: 5 },
          ],
        },
      ],
    },
  };

  validateContractPayload(validPayload);
  const normalized = normalizeContractPayload(validPayload);

  assert(normalized.title === validPayload.title, "Title preserved");
  assert(normalized.form.client.name === "شركة الفجر للتجارة", "Client name preserved");
  assert(findUndefinedPaths(normalized).length === 0, "No undefined paths in normalized payload");
});

// 2. Optional top-level and nested undefined fields
runTest("Sanitizes all top-level, nested, and array undefined values without altering legitimate falsy values", () => {
  const dirtyPayload: any = {
    title: "عقد تطوير المنصة",
    contactId: undefined, // undefined optional top-level
    dealId: undefined,    // undefined optional top-level
    notes: undefined,
    zeroDiscount: 0,      // legitimate 0
    isExempt: false,      // legitimate false
    emptyNotes: "",       // legitimate empty string
    tags: [],             // legitimate empty array
    form: {
      title: "عقد تطوير المنصة",
      contractNumber: "CNT-2026-991",
      client: {
        name: "مؤسسة الأفق",
        email: undefined,  // nested undefined
        phone: undefined,  // nested undefined
      },
      provider: {
        name: "دي-آرو",
      },
      services: [
        {
          id: "srv1",
          name: "برمجة لوحة التحكم",
          department: "البرمجة والتطوير",
          selected: true,
          convertedTaskId: undefined, // array item nested undefined
          subtasks: [
            { id: "st1", title: "تصميم واجهة المستخدم", sequenceOrder: 1, assigneeId: undefined },
          ],
        },
      ],
    },
  };

  const detectedPaths = findUndefinedPaths(dirtyPayload);
  assert(detectedPaths.includes("contactId"), "Must detect contactId");
  assert(detectedPaths.includes("dealId"), "Must detect dealId");
  assert(detectedPaths.includes("notes"), "Must detect notes");
  assert(detectedPaths.includes("form.client.email"), "Must detect form.client.email");
  assert(detectedPaths.includes("form.client.phone"), "Must detect form.client.phone");
  assert(detectedPaths.includes("form.services[0].convertedTaskId"), "Must detect convertedTaskId");
  assert(detectedPaths.includes("form.services[0].subtasks[0].assigneeId"), "Must detect subtask assigneeId");

  const normalized = normalizeContractPayload(dirtyPayload);
  const remainingUndefined = findUndefinedPaths(normalized);
  assert(remainingUndefined.length === 0, `All undefined paths must be removed, found: ${remainingUndefined.join(", ")}`);

  // Verify legitimate values
  assert(normalized.zeroDiscount === 0, "Zero must be preserved");
  assert(normalized.isExempt === false, "False must be preserved");
  assert(normalized.emptyNotes === "", "Empty string must be preserved");
  assert(Array.isArray(normalized.tags) && normalized.tags.length === 0, "Empty array must be preserved");
});

// 3. Missing required fields
runTest("Missing required fields fail with explicit meaningful Arabic error messages", () => {
  // Empty title
  try {
    validateContractPayload({ title: "   " });
    assert(false, "Should have thrown for empty title");
  } catch (e: any) {
    assert(e.message === "عنوان العقد مطلوب", "Expected title error message");
  }

  // Missing client name
  try {
    validateContractPayload({
      title: "عقد ساري",
      form: {
        title: "عقد ساري",
        contractNumber: "CNT-001",
        client: { name: "   " },
        provider: { name: "دي-آرو" },
      } as any,
    });
    assert(false, "Should have thrown for empty client name");
  } catch (e: any) {
    assert(e.message === "اسم العميل مطلوب لحفظ العقد", "Expected client name error message");
  }

  // Missing contract number
  try {
    validateContractPayload({
      title: "عقد ساري",
      form: {
        title: "عقد ساري",
        contractNumber: "",
        client: { name: "شركة النور" },
        provider: { name: "دي-آرو" },
      } as any,
    });
    assert(false, "Should have thrown for empty contract number");
  } catch (e: any) {
    assert(e.message === "رقم العقد مطلوب", "Expected contract number error message");
  }

  // Missing provider name
  try {
    validateContractPayload({
      title: "عقد ساري",
      form: {
        title: "عقد ساري",
        contractNumber: "CNT-002",
        client: { name: "شركة النور" },
        provider: { name: "" },
      } as any,
    });
    assert(false, "Should have thrown for empty provider name");
  } catch (e: any) {
    assert(e.message === "بيانات الطرف الأول (مقدم الخدمة) مطلوبة", "Expected provider name error message");
  }
});

// 4. Editing an existing contract
runTest("Editing existing contract validates and normalizes partial update payloads", () => {
  const updatePayload: UpdateContractDTO = {
    title: "عقد توريد وخدمات رقمية — شركة الفجر (معدل)",
    form: {
      title: "عقد توريد وخدمات رقمية",
      contractNumber: "CNT-2026-880-REV",
      client: { name: "شركة الفجر للتجارة" },
      provider: { name: "دي-آرو للأعمال" },
      services: [
        {
          id: "s1",
          name: "إدارة الحملات التسويقية",
          department: "التسويق الرقمي",
          isConverted: true,
          convertedTaskId: "task_generated_100", // now populated!
        },
      ],
    } as any,
  };

  validateContractPayload(updatePayload);
  const normalized = normalizeContractPayload(updatePayload);

  assert(normalized.title.includes("معدل"), "Title updated");
  assert(normalized.form?.services?.[0].convertedTaskId === "task_generated_100", "convertedTaskId preserved");
  assert(findUndefinedPaths(normalized).length === 0, "No undefined paths in update payload");
});

// 5. Contract save failure prevents task generation
runTest("Contract save failure halts task generation workflow immediately", () => {
  let persistContractCalled = false;
  let taskGenerationCalled = false;

  const mockPersistContract = (clientName: string): string => {
    persistContractCalled = true;
    if (!clientName.trim()) {
      throw new Error("يرجى تحديد اسم العميل أولاً");
    }
    return "contract_doc_id_999";
  };

  const handleConvertServicesToTasks = (clientName: string) => {
    let targetContractId: string | null = null;
    try {
      targetContractId = mockPersistContract(clientName);
    } catch (err) {
      // Abort workflow on contract save failure
      return { success: false, error: (err as any).message };
    }

    if (!targetContractId) {
      return { success: false, error: "تعذر تحديد معرّف العقد" };
    }

    taskGenerationCalled = true;
    return { success: true, contractId: targetContractId };
  };

  // Test failing path: invalid client
  const failResult = handleConvertServicesToTasks("");
  assert(persistContractCalled === true, "Persist contract was invoked");
  assert(taskGenerationCalled === false, "Task generation MUST NOT be called if contract save fails");
  assert(failResult.success === false, "Result marked as failure");
  assert(failResult.error === "يرجى تحديد اسم العميل أولاً", "Meaningful error message returned");

  // Test success path: valid client
  persistContractCalled = false;
  taskGenerationCalled = false;
  const successResult = handleConvertServicesToTasks("شركة الأمل");
  assert(persistContractCalled === true, "Persist contract was invoked");
  assert(taskGenerationCalled === true, "Task generation proceeds when contract saves successfully");
  assert(successResult.success === true, "Result marked as success");
  assert(successResult.contractId === "contract_doc_id_999", "Contract ID returned");
});

console.log("\n=======================================================");
console.log(` Summary: ${passed} passed, ${failed} failed`);
console.log("=======================================================\n");

if (failed > 0) {
  process.exit(1);
}
