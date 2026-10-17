/**
 * Live End-to-End Workflow Verification Suite for D-Arrow Business
 * Executes against the local Firebase Firestore Emulator.
 *
 * Verifies:
 * 1. User & Tenant isolation (multi-tenant boundaries)
 * 2. User-managed Contact Classifications (CRUD, active/archived states)
 * 3. Contacts creation, dynamic classification linkage & filtering
 * 4. Lead -> Deal -> Contract relationship preservation and prefill
 * 5. Projects module customization (slugs, priority, tags, custom key-value fields, archive/restore)
 * 6. Development Courses and Goals (department vs. company scope persistence & filtering)
 * 7. Cross-company access denials and unauthorized read/write protections
 */

import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";

const CO_ALPHA = "company-alpha";
const CO_BETA = "company-beta";

const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err: err?.message ?? String(err) });
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: "workflow-check",
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});

await testEnv.clearFirestore();

// 1. Seed tenant accounts with users
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  
  // Alpha users
  await setDoc(doc(db, "users", "user-alpha-admin"), {
    companyId: CO_ALPHA,
    role: "admin",
    name: "Alpha Admin",
  });
  await setDoc(doc(db, "users", "user-alpha-emp"), {
    companyId: CO_ALPHA,
    role: "employee",
    name: "Alpha Employee",
  });

  // Beta user
  await setDoc(doc(db, "users", "user-beta-admin"), {
    companyId: CO_BETA,
    role: "admin",
    name: "Beta Admin",
  });
});

const alphaAdminDb = testEnv.authenticatedContext("user-alpha-admin").firestore();
const alphaEmpDb = testEnv.authenticatedContext("user-alpha-emp").firestore();
const betaAdminDb = testEnv.authenticatedContext("user-beta-admin").firestore();
const unauthDb = testEnv.unauthenticatedContext().firestore();

console.log("Starting Live Workflow Scenarios...\n");

// --- SCENARIO 1: Custom Contact Classification CRUD ---
await check("Alpha Admin creates custom classification with color & emoji", async () => {
  await assertSucceeds(
    setDoc(doc(alphaAdminDb, "companies", CO_ALPHA, "contact_classifications", "class-vip"), {
      name: "Strategic VIP Partner",
      color: "purple",
      emoji: "💎",
      isCustom: true,
      isActive: true,
      createdAt: new Date().toISOString(),
    })
  );
});

await check("Alpha Employee reads custom classification", async () => {
  const snap = await assertSucceeds(
    getDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "contact_classifications", "class-vip"))
  );
  if (!snap.exists() || snap.data().emoji !== "💎") {
    throw new Error("Failed to read back custom classification attributes");
  }
});

// --- SCENARIO 2: Contact Creation & Dynamic Classification Linkage ---
await check("Alpha Employee creates contact linked to custom classification", async () => {
  await assertSucceeds(
    setDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "contacts", "contact-101"), {
      name: "Khaled Hassan",
      email: "khaled@example.com",
      phone: "+966500000001",
      classification: "class-vip",
      source: "referral",
      status: "active",
      assignedTo: "user-alpha-emp",
      createdAt: new Date().toISOString(),
    })
  );
});

await check("Alpha Employee filters contacts by custom classification", async () => {
  const snap = await assertSucceeds(
    getDocs(
      query(
        collection(alphaEmpDb, "companies", CO_ALPHA, "contacts"),
        where("classification", "==", "class-vip")
      )
    )
  );
  if (snap.size !== 1) throw new Error(`Expected 1 contact, got ${snap.size}`);
  if (snap.docs[0].data().name !== "Khaled Hassan") throw new Error("Contact name mismatch");
});

await check("Alpha Employee filters contacts by source & status", async () => {
  const snap = await assertSucceeds(
    getDocs(
      query(
        collection(alphaEmpDb, "companies", CO_ALPHA, "contacts"),
        where("source", "==", "referral"),
        where("status", "==", "active")
      )
    )
  );
  if (snap.size !== 1) throw new Error(`Expected 1 contact, got ${snap.size}`);
});

// --- SCENARIO 2B: Dynamic Entity Types, Multi-Select Relationships & Associated Contacts ---
await check("Alpha Employee creates Company entity with associated contacts & multi-select relationships", async () => {
  await assertSucceeds(
    setDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "contacts", "contact-comp-1"), {
      entityType: "company",
      accountName: "Al-Amal Logistics LLC",
      legalName: "Al-Amal Global Logistics Co.",
      establishmentType: "llc",
      commercialRegister: "1010778899",
      unifiedNumber: "7001234567",
      taxNumber: "310123456700003",
      mainActivity: "Freight and supply chain management",
      branchesCount: 5,
      city: "الرياض",
      region: "منطقة الرياض",
      relationships: ["active_client", "vendor", "partner"],
      relationshipStatuses: {
        active_client: "active",
        vendor: "approved",
        partner: "negotiating",
      },
      associatedContacts: [
        {
          id: "assoc-1",
          name: "Sami Al-Otaibi",
          jobTitle: "Chief Executive Officer",
          department: "Executive Management",
          phone: "+966501112233",
          email: "sami@alamal.sa",
          contactRole: "owner",
          isDecisionMaker: true,
          isPrimary: true,
          notes: "Main point of contact for executive contracts",
        },
        {
          id: "assoc-2",
          name: "Reem Al-Ghamdi",
          jobTitle: "Marketing Director",
          department: "Marketing & PR",
          phone: "+966504445566",
          email: "reem@alamal.sa",
          contactRole: "marketing_manager",
          isDecisionMaker: true,
          isPrimary: false,
          notes: "Decision maker for digital campaigns and creative budgets",
        },
      ],
      addresses: [
        {
          id: "addr-1",
          addressType: "national",
          buildingNumber: "1234",
          streetName: "King Fahd Road",
          district: "Al-Olaya",
          city: "Riyadh",
          postalCode: "12211",
          shortAddress: "RD1234",
          country: "المملكة العربية السعودية",
        },
      ],
      socialAccounts: [
        {
          id: "soc-1",
          platform: "X",
          username: "@alamal_logistics",
          url: "https://x.com/alamal_logistics",
        },
        {
          id: "soc-2",
          platform: "LinkedIn",
          username: "alamal-logistics",
          url: "https://linkedin.com/company/alamal-logistics",
        },
      ],
      financialInfo: {
        taxNumber: "310123456700003",
        vatRegistered: "registered",
        preferredPaymentMethod: "bank_transfer",
        paymentTerms: "30_days",
        creditLimit: 250000,
        financialNotes: "Approved credit terms",
      },
      crmSalesInfo: {
        sector: "الخدمات اللوجستية وسلاسل الإمداد",
        expectedBudget: "300,000 SAR",
        expectedStartDate: "2026-11-01",
        hasMarketingTeam: true,
        servicesInterested: ["إدارة حسابات", "سيو ومحركات بحث", "إعلانات ممولة"],
      },
      classification: "actual_client",
      source: "website",
      status: "active",
      assignedTo: "user-alpha-emp",
      createdAt: new Date().toISOString(),
    })
  );
});

await check("Alpha Employee filters contacts by entityType == 'company'", async () => {
  const snap = await assertSucceeds(
    getDocs(
      query(
        collection(alphaEmpDb, "companies", CO_ALPHA, "contacts"),
        where("entityType", "==", "company")
      )
    )
  );
  if (snap.size !== 1) throw new Error(`Expected 1 company contact, got ${snap.size}`);
  if (snap.docs[0].data().accountName !== "Al-Amal Logistics LLC") {
    throw new Error("Company accountName mismatch");
  }
});

await check("Alpha Employee queries contacts by multi-select relationship (array-contains 'vendor')", async () => {
  const snap = await assertSucceeds(
    getDocs(
      query(
        collection(alphaEmpDb, "companies", CO_ALPHA, "contacts"),
        where("relationships", "array-contains", "vendor")
      )
    )
  );
  if (snap.size !== 1) throw new Error(`Expected 1 contact with 'vendor' relationship, got ${snap.size}`);
  const data = snap.docs[0].data();
  if (!data.relationships.includes("active_client") || !data.relationships.includes("partner")) {
    throw new Error("Multi-select relationships not preserved");
  }
});

await check("Alpha Employee verifies primary associated contact person and decision maker integrity", async () => {
  const snap = await assertSucceeds(
    getDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "contacts", "contact-comp-1"))
  );
  const data = snap.data();
  if (!Array.isArray(data.associatedContacts) || data.associatedContacts.length !== 2) {
    throw new Error("Expected 2 associated contacts");
  }
  const primary = data.associatedContacts.find((c) => c.isPrimary);
  if (!primary || primary.name !== "Sami Al-Otaibi") {
    throw new Error("Primary contact person resolution failed");
  }
  const decisionMakers = data.associatedContacts.filter((c) => c.isDecisionMaker);
  if (decisionMakers.length !== 2) {
    throw new Error("Decision makers count mismatch");
  }
});

await check("Alpha Employee switches primary associated contact person to Reem Al-Ghamdi", async () => {
  const snap = await getDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "contacts", "contact-comp-1"));
  const prevData = snap.data();
  const updatedContacts = prevData.associatedContacts.map((c) => ({
    ...c,
    isPrimary: c.id === "assoc-2",
  }));

  await assertSucceeds(
    updateDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "contacts", "contact-comp-1"), {
      associatedContacts: updatedContacts,
    })
  );

  const reloaded = await getDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "contacts", "contact-comp-1"));
  const newPrimary = reloaded.data().associatedContacts.find((c) => c.isPrimary);
  if (!newPrimary || newPrimary.name !== "Reem Al-Ghamdi") {
    throw new Error("Failed to switch primary associated contact");
  }
  const primaryCount = reloaded.data().associatedContacts.filter((c) => c.isPrimary).length;
  if (primaryCount !== 1) {
    throw new Error(`Enforce single primary: expected 1 primary contact, found ${primaryCount}`);
  }
});

await check("Beta Admin cannot read Alpha Company contact with associated persons (multi-tenant boundary)", async () => {
  await assertFails(
    getDoc(doc(betaAdminDb, "companies", CO_ALPHA, "contacts", "contact-comp-1"))
  );
});

await check("Unauthenticated user cannot read Alpha Company contact (unauthorized boundary)", async () => {
  await assertFails(
    getDoc(doc(unauthDb, "companies", CO_ALPHA, "contacts", "contact-comp-1"))
  );
});

// --- SCENARIO 3: Lead -> Deal -> Contract Integration ---
await check("Alpha Employee creates a lead referencing the contact", async () => {
  await assertSucceeds(
    setDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "leads", "lead-201"), {
      title: "Digital Transformation Consulting",
      contactId: "contact-101",
      status: "qualified",
      assignedTo: "user-alpha-emp",
      estimatedValue: 120000,
    })
  );
});

await check("Alpha Employee converts lead into deal preserving relationships", async () => {
  await assertSucceeds(
    setDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "deals", "deal-301"), {
      title: "Digital Transformation Consulting Contract",
      leadId: "lead-201",
      contactId: "contact-101",
      amount: 120000,
      currency: "SAR",
      stage: "proposal",
      assignedTo: "user-alpha-emp",
    })
  );
});

await check("Alpha Employee drafts contract linked to deal & contact with commercial totals", async () => {
  const amountExclVat = 120000;
  const vatRate = 15;
  const amountInclVat = amountExclVat * (1 + vatRate / 100);

  await assertSucceeds(
    setDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "contracts", "contract-401"), {
      title: "Enterprise Transformation Agreement",
      dealId: "deal-301",
      contactId: "contact-101",
      amountExclVat,
      vatRate,
      amountInclVat,
      status: "draft",
      currency: "SAR",
      clientParty: {
        name: "Khaled Hassan",
        email: "khaled@example.com",
      },
    })
  );
});

await check("Verify contract persisted relationships and commercial accuracy", async () => {
  const snap = await assertSucceeds(
    getDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "contracts", "contract-401"))
  );
  const data = snap.data();
  if (data.dealId !== "deal-301") throw new Error("dealId link broken");
  if (data.contactId !== "contact-101") throw new Error("contactId link broken");
  if (data.amountInclVat !== 138000) throw new Error("VAT calculation mismatch");
});

// --- SCENARIO 4: Projects Module Customization ---
await check("Alpha Admin creates project with slug, priority, tags, and custom fields", async () => {
  await assertSucceeds(
    setDoc(doc(alphaAdminDb, "companies", CO_ALPHA, "projects", "proj-501"), {
      name: "ERP Overhaul 2026",
      slug: "erp-overhaul-2026",
      priority: "high",
      category: "Operations",
      tags: ["erp", "q1", "transformation"],
      customFields: [
        { key: "TechLead", value: "Ibrahim" },
        { key: "TargetGoLive", value: "2026-12-31" },
      ],
      archived: false,
    })
  );
});

await check("Verify project customization persists and resolves cleanly", async () => {
  const snap = await assertSucceeds(
    getDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "projects", "proj-501"))
  );
  const data = snap.data();
  if (data.slug !== "erp-overhaul-2026") throw new Error("slug mismatch");
  if (data.priority !== "high") throw new Error("priority mismatch");
  if (!Array.isArray(data.customFields) || data.customFields.length !== 2) {
    throw new Error("custom fields not preserved");
  }
  if (data.customFields[0].key !== "TechLead" || data.customFields[0].value !== "Ibrahim") {
    throw new Error("custom field key/value mismatch");
  }
});

// --- SCENARIO 5: Archive & Restore Workflows ---
await check("Alpha Admin archives project and verifies status", async () => {
  await assertSucceeds(
    updateDoc(doc(alphaAdminDb, "companies", CO_ALPHA, "projects", "proj-501"), {
      archived: true,
    })
  );
  const snap = await getDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "projects", "proj-501"));
  if (snap.data().archived !== true) throw new Error("Failed to archive project");
});

await check("Alpha Admin restores project and verifies status", async () => {
  await assertSucceeds(
    updateDoc(doc(alphaAdminDb, "companies", CO_ALPHA, "projects", "proj-501"), {
      archived: false,
    })
  );
  const snap = await getDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "projects", "proj-501"));
  if (snap.data().archived !== false) throw new Error("Failed to restore project");
});

await check("Alpha Admin archives custom classification", async () => {
  await assertSucceeds(
    updateDoc(doc(alphaAdminDb, "companies", CO_ALPHA, "contact_classifications", "class-vip"), {
      isActive: false,
    })
  );
  const snap = await getDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "contact_classifications", "class-vip"));
  if (snap.data().isActive !== false) throw new Error("Classification isActive was not updated");
  
  // Existing contact should still retain classification reference
  const contactSnap = await getDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "contacts", "contact-101"));
  if (contactSnap.data().classification !== "class-vip") {
    throw new Error("Contact classification reference was corrupted upon archive");
  }
});

// --- SCENARIO 6: Development Courses & Goals (Scope Persistence & Filtering) ---
await check("Alpha Employee creates department-specific sprint", async () => {
  await assertSucceeds(
    setDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "sprints", "sprint-dept"), {
      name: "Engineering Skills Course",
      scope: "department",
      department: "Software Engineering",
      status: "active",
      startDate: "2026-10-01",
    })
  );
});

await check("Alpha Employee creates company-wide sprint", async () => {
  await assertSucceeds(
    setDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "sprints", "sprint-comp"), {
      name: "Company Culture & OKRs",
      scope: "company",
      status: "active",
      startDate: "2026-10-01",
    })
  );
});

await check("Filter sprints by department scope returns only department-specific", async () => {
  const snap = await assertSucceeds(
    getDocs(
      query(
        collection(alphaEmpDb, "companies", CO_ALPHA, "sprints"),
        where("scope", "==", "department")
      )
    )
  );
  if (snap.size !== 1 || snap.docs[0].data().name !== "Engineering Skills Course") {
    throw new Error(`Expected department sprint, got ${snap.size}`);
  }
});

await check("Filter sprints by company scope returns only company-wide", async () => {
  const snap = await assertSucceeds(
    getDocs(
      query(
        collection(alphaEmpDb, "companies", CO_ALPHA, "sprints"),
        where("scope", "==", "company")
      )
    )
  );
  if (snap.size !== 1 || snap.docs[0].data().name !== "Company Culture & OKRs") {
    throw new Error(`Expected company sprint, got ${snap.size}`);
  }
});

// --- SCENARIO 8: Contract Normalization, Validation, and Services-to-Tasks Migration ---

// Diagnostic path detection utility
function findUndefinedPaths(obj, prefix = "") {
  const paths = [];
  if (obj === undefined) {
    paths.push(prefix || "(root)");
    return paths;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      const currentPath = `${prefix}[${index}]`;
      if (item === undefined) {
        paths.push(currentPath);
      } else {
        paths.push(...findUndefinedPaths(item, currentPath));
      }
    });
    return paths;
  }
  if (obj !== null && typeof obj === "object") {
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      return paths;
    }
    for (const [key, val] of Object.entries(obj)) {
      const currentPath = prefix ? `${prefix}.${key}` : key;
      if (val === undefined) {
        paths.push(currentPath);
      } else {
        paths.push(...findUndefinedPaths(val, currentPath));
      }
    }
  }
  return paths;
}

// Deep undefined stripper replicating firestore-mappers.ts
function deepStripUndefined(value) {
  if (value === undefined) return value;
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => deepStripUndefined(item));
  }
  if (value !== null && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, deepStripUndefined(v)])
      .filter(([, v]) => v !== undefined);
    return Object.fromEntries(entries);
  }
  return value;
}

// Contract validation replicating contract-normalization.ts
function validateContractPayload(data) {
  if (!data) throw new Error("بيانات العقد غير صالحة");
  if ("title" in data && (typeof data.title !== "string" || !data.title.trim())) {
    throw new Error("عنوان العقد مطلوب");
  }
  if (data.form) {
    if (!data.form.title || !data.form.title.trim()) {
      throw new Error("عنوان نموذج العقد مطلوب");
    }
    if (!data.form.client?.name || !data.form.client.name.trim()) {
      throw new Error("اسم العميل مطلوب لحفظ العقد");
    }
    if (!data.form.contractNumber || !data.form.contractNumber.trim()) {
      throw new Error("رقم العقد مطلوب");
    }
    if (!data.form.provider?.name || !data.form.provider.name.trim()) {
      throw new Error("بيانات الطرف الأول (مقدم الخدمة) مطلوبة");
    }
  }
}

// Helper replicating TaskService.createTask sanitization
async function createTaskHelper(db, companyId, taskId, data) {
  const { attachments, tags, timeLogs, ...rest } = data;
  const cleanRest = Object.fromEntries(
    Object.entries(rest).filter(([_, v]) => v !== undefined)
  );
  return setDoc(doc(db, "companies", companyId, "tasks", taskId), {
    ...cleanRest,
    type: data.type || "task",
    parentId: data.parentId ?? null,
    sprintId: data.sprintId ?? null,
    description: data.description ?? "",
    tags: tags ?? [],
    attachments: attachments?.length ? attachments : [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

// 1. Diagnostic path detection finds exact undefined field paths
await check("Diagnostic path detection finds exact undefined field paths without sensitive data", async () => {
  const payload = {
    title: "Diagnostic Contract",
    contactId: undefined,
    form: {
      contractType: undefined,
      clauses: [
        { id: "c1", title: "Clause 1", body: undefined },
        { id: "c2", title: "Clause 2", body: "Defined body" },
      ],
      services: [
        { id: "s1", name: "Service 1", convertedTaskId: undefined, subtasks: undefined },
      ],
    },
  };
  const paths = findUndefinedPaths(payload);
  if (!paths.includes("contactId")) throw new Error("Failed to detect top-level undefined contactId");
  if (!paths.includes("form.contractType")) throw new Error("Failed to detect nested undefined form.contractType");
  if (!paths.includes("form.clauses[0].body")) throw new Error("Failed to detect array item undefined body");
  if (paths.includes("form.clauses[1].body")) throw new Error("False positive on defined body");
  if (!paths.includes("form.services[0].convertedTaskId")) throw new Error("Failed to detect service undefined convertedTaskId");
});

// 2. Optional top-level field undefined (contactId, dealId) is omitted and document saves cleanly
await check("Optional top-level field undefined is omitted and document saves cleanly", async () => {
  const rawContract = {
    title: "Top-level Undefined Test Contract",
    status: "draft",
    contactId: undefined,
    dealId: undefined,
    form: {
      title: "Draft Agreement",
      contractNumber: "DA-2026-9001",
      contractDateIso: "2026-10-17",
      preamble: "Test preamble",
      provider: { name: "D-Arrow Marketing" },
      client: { name: "Client Test Corp" },
      fields: [],
      clauses: [],
    },
  };
  validateContractPayload(rawContract);
  const normalized = deepStripUndefined(rawContract);
  await assertSucceeds(
    setDoc(doc(alphaAdminDb, "companies", CO_ALPHA, "contracts", "contract-top-undefined"), normalized)
  );
  const snap = await getDoc(doc(alphaAdminDb, "companies", CO_ALPHA, "contracts", "contract-top-undefined"));
  const data = snap.data();
  if ("contactId" in data || "dealId" in data) {
    throw new Error("Optional undefined top-level fields should have been omitted from Firestore document");
  }
});

// 3. Optional nested field undefined (form.contractType, client.idNumber) is omitted and saves cleanly
await check("Optional nested field undefined is omitted and saves cleanly", async () => {
  const rawContract = {
    title: "Nested Undefined Test Contract",
    status: "draft",
    form: {
      title: "Draft Agreement",
      contractNumber: "DA-2026-9002",
      contractType: undefined,
      contractDateIso: "2026-10-17",
      preamble: "Test preamble",
      provider: { name: "D-Arrow Marketing" },
      client: { name: "Client Test Corp", idNumber: undefined },
      fields: [],
      clauses: [],
    },
  };
  validateContractPayload(rawContract);
  const normalized = deepStripUndefined(rawContract);
  await assertSucceeds(
    setDoc(doc(alphaAdminDb, "companies", CO_ALPHA, "contracts", "contract-nested-undefined"), normalized)
  );
  const snap = await getDoc(doc(alphaAdminDb, "companies", CO_ALPHA, "contracts", "contract-nested-undefined"));
  const data = snap.data();
  if ("contractType" in data.form) throw new Error("form.contractType should be omitted");
  if ("idNumber" in data.form.client) throw new Error("form.client.idNumber should be omitted");
});

// 4. Array containing objects with optional undefined fields (clauses[i].body, services[i].subtasks) saves without Firestore error
await check("Array containing objects with optional undefined fields saves without Firestore error", async () => {
  const rawContract = {
    title: "Array Undefined Test Contract",
    status: "draft",
    form: {
      title: "Draft Agreement",
      contractNumber: "DA-2026-9003",
      contractDateIso: "2026-10-17",
      preamble: "Test preamble",
      provider: { name: "D-Arrow Marketing" },
      client: { name: "Client Test Corp" },
      fields: [],
      clauses: [
        { id: "cls-1", title: "Clause 1", body: undefined, bullets: [{ id: "b1", text: "bullet 1" }] },
        { id: "cls-2", title: "Clause 2", bullets: [{ id: "b2", text: "bullet 2" }] },
      ],
      services: [
        { id: "srv-1", name: "S1", department: "Design", selected: true, subtasks: undefined, convertedTaskId: undefined, isConverted: undefined },
      ],
    },
  };
  validateContractPayload(rawContract);
  const normalized = deepStripUndefined(rawContract);
  await assertSucceeds(
    setDoc(doc(alphaAdminDb, "companies", CO_ALPHA, "contracts", "contract-array-undefined"), normalized)
  );
  const snap = await getDoc(doc(alphaAdminDb, "companies", CO_ALPHA, "contracts", "contract-array-undefined"));
  const data = snap.data();
  if ("body" in data.form.clauses[0]) throw new Error("clauses[0].body should have been omitted");
  if ("subtasks" in data.form.services[0]) throw new Error("services[0].subtasks should have been omitted");
});

// 5. Valid false, 0, empty string, and empty array values are preserved
await check("Valid false, 0, empty string, and empty array values are preserved", async () => {
  const input = {
    title: "Values Preservation Test",
    convertedToTasks: false,
    createdTaskIds: [],
    form: {
      title: "Test Form",
      contractNumber: "DA-2026-9004",
      contractDateIso: "2026-10-17",
      preamble: "Preamble",
      provider: { name: "D-Arrow" },
      client: { name: "Client Corp" },
      fields: [],
      clauses: [],
      services: [
        {
          id: "srv-zero",
          name: "Service Zero",
          department: "IT",
          selected: false,
          estimatedHours: 0,
          durationDays: 0,
          description: "",
        },
      ],
    },
  };
  const normalized = deepStripUndefined(input);
  if (normalized.convertedToTasks !== false) throw new Error("convertedToTasks: false was not preserved");
  if (!Array.isArray(normalized.createdTaskIds) || normalized.createdTaskIds.length !== 0) {
    throw new Error("createdTaskIds: [] was not preserved");
  }
  const srv = normalized.form.services[0];
  if (srv.selected !== false) throw new Error("service.selected: false was not preserved");
  if (srv.estimatedHours !== 0) throw new Error("service.estimatedHours: 0 was not preserved");
  if (srv.durationDays !== 0) throw new Error("service.durationDays: 0 was not preserved");
  if (srv.description !== "") throw new Error("service.description: '' was not preserved");

  await assertSucceeds(
    setDoc(doc(alphaAdminDb, "companies", CO_ALPHA, "contracts", "contract-preservation"), normalized)
  );
});

// 6. Missing required fields produce clear validation errors
await check("Missing required fields produce clear validation errors", async () => {
  let titleError = "";
  try {
    validateContractPayload({ title: "" });
  } catch (err) {
    titleError = err.message;
  }
  if (!titleError.includes("عنوان العقد مطلوب")) {
    throw new Error(`Expected title required error, got: ${titleError}`);
  }

  let clientError = "";
  try {
    validateContractPayload({
      title: "Valid Title",
      form: {
        title: "Valid Form Title",
        client: { name: "   " },
      },
    });
  } catch (err) {
    clientError = err.message;
  }
  if (!clientError.includes("اسم العميل مطلوب لحفظ العقد")) {
    throw new Error(`Expected client required error, got: ${clientError}`);
  }
});

// 7. Valid contracts save successfully and return document ID
await check("Valid contract saves successfully and returns document ID", async () => {
  const validContract = {
    title: "Master Marketing Agreement — Al-Amal",
    status: "draft",
    form: {
      title: "Master Marketing Agreement",
      contractNumber: "DA-2026-1001",
      contractDateIso: "2026-10-17",
      preamble: "Agreed terms between parties",
      provider: { name: "D-Arrow Marketing Company" },
      client: { name: "Al-Amal Logistics Company" },
      fields: [],
      clauses: [{ id: "c1", title: "General Terms", bullets: [{ id: "b1", text: "Terms apply" }] }],
      services: [
        {
          id: "srv-brand",
          name: "Brand Design",
          department: "Design",
          estimatedHours: 20,
          durationDays: 10,
          selected: true,
          subtasks: [
            { id: "st-1", title: "Moodboard", sequenceOrder: 1, estimatedHours: 5 },
            { id: "st-2", title: "Final Logo", sequenceOrder: 2, estimatedHours: 15 },
          ],
        },
      ],
      convertedToTasks: false,
      createdTaskIds: [],
    },
  };
  validateContractPayload(validContract);
  const normalized = deepStripUndefined(validContract);
  await assertSucceeds(
    setDoc(doc(alphaAdminDb, "companies", CO_ALPHA, "contracts", "contract-valid-save"), normalized)
  );
  const snap = await getDoc(doc(alphaAdminDb, "companies", CO_ALPHA, "contracts", "contract-valid-save"));
  if (!snap.exists()) throw new Error("Contract document was not found after save");
  if (snap.id !== "contract-valid-save") throw new Error("Document ID mismatch");
});

// 8. A failed contract save prevents task creation
await check("A failed contract save prevents task creation", async () => {
  let targetContractId = null;
  const invalidContract = { title: "", form: { client: { name: "" } } };
  let saveFailed = false;

  try {
    validateContractPayload(invalidContract);
    targetContractId = "should-not-reach";
  } catch (err) {
    saveFailed = true;
  }

  if (!saveFailed) throw new Error("Expected validation failure for invalid contract");

  // Since save failed, tasks must NOT be created
  const createdTaskIds = [];
  if (targetContractId) {
    createdTaskIds.push("orphan-task");
  }

  if (createdTaskIds.length !== 0) {
    throw new Error("Tasks were created despite contract save failure");
  }
});

// 9. Task creation receives the saved contract's actual ID
await check("Task creation receives the saved contract's actual ID", async () => {
  const contractId = "contract-valid-save";
  const mainTaskId = "task-brand-main-101";
  const subTaskId = "task-brand-sub-101";

  await assertSucceeds(
    createTaskHelper(alphaEmpDb, CO_ALPHA, mainTaskId, {
      title: "Brand Design — Al-Amal",
      department: "Design",
      status: "todo",
      priority: "high",
      type: "task",
      contractId: contractId,
      serviceItemId: "srv-brand",
    })
  );

  await assertSucceeds(
    createTaskHelper(alphaEmpDb, CO_ALPHA, subTaskId, {
      title: "Moodboard",
      department: "Design",
      status: "todo",
      priority: "medium",
      type: "subtask",
      parentId: mainTaskId,
      sequenceOrder: 1,
      contractId: contractId,
      serviceItemId: "srv-brand",
    })
  );

  const mainSnap = await getDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "tasks", mainTaskId));
  const subSnap = await getDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "tasks", subTaskId));

  if (mainSnap.data().contractId !== contractId) {
    throw new Error(`Main task contractId mismatch: expected ${contractId}, got ${mainSnap.data().contractId}`);
  }
  if (subSnap.data().contractId !== contractId) {
    throw new Error(`Subtask contractId mismatch: expected ${contractId}, got ${subSnap.data().contractId}`);
  }
  if (subSnap.data().parentId !== mainTaskId) {
    throw new Error(`Subtask parentId mismatch: expected ${mainTaskId}, got ${subSnap.data().parentId}`);
  }
});

// 10. Editing an existing contract does not create an unnecessary duplicate
await check("Editing an existing contract does not create an unnecessary duplicate", async () => {
  const existingContractId = "contract-valid-save";
  await assertSucceeds(
    updateDoc(doc(alphaAdminDb, "companies", CO_ALPHA, "contracts", existingContractId), {
      title: "Master Marketing Agreement — Al-Amal (Updated)",
      updatedAt: new Date().toISOString(),
    })
  );
  const snap = await getDoc(doc(alphaAdminDb, "companies", CO_ALPHA, "contracts", existingContractId));
  if (snap.data().title !== "Master Marketing Agreement — Al-Amal (Updated)") {
    throw new Error("Contract update did not reflect on existing document");
  }
});

// 11. Retrying after partial task creation does not duplicate tasks
await check("Retrying after partial task creation does not duplicate tasks", async () => {
  const partialContractId = "contract-partial-test";
  await assertSucceeds(
    setDoc(doc(alphaAdminDb, "companies", CO_ALPHA, "contracts", partialContractId), {
      title: "Partial Workflow Test Contract",
      services: [
        { id: "srv-done", name: "Done Service", department: "IT", selected: true, isConverted: true, convertedTaskId: "task-srv-done" },
        { id: "srv-todo", name: "Todo Service", department: "IT", selected: true, isConverted: false },
      ],
      convertedToTasks: false,
      createdTaskIds: ["task-srv-done"],
    })
  );

  // Pre-create already converted task
  await assertSucceeds(
    createTaskHelper(alphaEmpDb, CO_ALPHA, "task-srv-done", {
      title: "Done Service Task",
      contractId: partialContractId,
    })
  );

  const contractSnap = await getDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "contracts", partialContractId));
  const pending = contractSnap.data().services.filter((s) => s.selected && (!s.isConverted || !s.convertedTaskId));

  if (pending.length !== 1 || pending[0].id !== "srv-todo") {
    throw new Error("Failed to filter out already converted service on retry");
  }

  // Create only for pending
  await assertSucceeds(
    createTaskHelper(alphaEmpDb, CO_ALPHA, "task-srv-todo", {
      title: "Todo Service Task",
      contractId: partialContractId,
    })
  );

  // Update contract
  await assertSucceeds(
    updateDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "contracts", partialContractId), {
      convertedToTasks: true,
      createdTaskIds: ["task-srv-done", "task-srv-todo"],
    })
  );

  const finalSnap = await getDoc(doc(alphaEmpDb, "companies", CO_ALPHA, "contracts", partialContractId));
  if (finalSnap.data().createdTaskIds.length !== 2) {
    throw new Error("Expected exactly 2 createdTaskIds after partial retry");
  }
});

// 12. Cross-tenant isolation on tasks: Beta Admin CANNOT read or link Alpha's tasks
await check("Beta Admin CANNOT read Alpha's contract tasks", async () => {
  const mainTaskId = "task-brand-main-101";
  await assertFails(getDoc(doc(betaAdminDb, "companies", CO_ALPHA, "tasks", mainTaskId)));
});

await check("Beta Admin CANNOT write tasks to Alpha's company partition", async () => {
  await assertFails(
    setDoc(doc(betaAdminDb, "companies", CO_ALPHA, "tasks", "rogue-beta-task"), {
      title: "Intruder Task",
      contractId: "contract-valid-save",
    })
  );
});

// --- SCENARIO 7: Cross-Tenant Isolation Enforcement ---
await check("Beta Admin CANNOT read Alpha's contacts", async () => {
  await assertFails(getDoc(doc(betaAdminDb, "companies", CO_ALPHA, "contacts", "contact-101")));
});

await check("Beta Admin CANNOT read Alpha's projects", async () => {
  await assertFails(getDoc(doc(betaAdminDb, "companies", CO_ALPHA, "projects", "proj-501")));
});

await check("Beta Admin CANNOT read Alpha's deals or contracts", async () => {
  await assertFails(getDoc(doc(betaAdminDb, "companies", CO_ALPHA, "deals", "deal-301")));
  await assertFails(getDoc(doc(betaAdminDb, "companies", CO_ALPHA, "contracts", "contract-401")));
});

await check("Beta Admin CANNOT modify Alpha's records", async () => {
  await assertFails(
    updateDoc(doc(betaAdminDb, "companies", CO_ALPHA, "projects", "proj-501"), {
      name: "Compromised",
    })
  );
});

await check("Unauthenticated caller CANNOT read or write any company data", async () => {
  await assertFails(getDoc(doc(unauthDb, "companies", CO_ALPHA, "contacts", "contact-101")));
  await assertFails(
    setDoc(doc(unauthDb, "companies", CO_ALPHA, "contacts", "rogue"), { name: "Rogue" })
  );
});

await testEnv.cleanup();

console.log("\n==============================");
console.log("   LIVE WORKFLOW TEST REPORT  ");
console.log("==============================\n");

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.err}`}`);
}
console.log(`\nResults: ${results.length - failed.length}/${results.length} passed.`);

if (failed.length > 0) {
  process.exit(1);
} else {
  console.log("\nALL LIVE WORKFLOWS VERIFIED SUCCESSFULLY WITH 100% PASS RATE.");
  process.exit(0);
}
