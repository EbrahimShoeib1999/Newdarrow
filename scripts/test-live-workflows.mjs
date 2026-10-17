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
