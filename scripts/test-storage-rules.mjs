/**
 * D-Arrow Business — Storage Rules Unit & Integration Test Suite
 * Executes against local Firebase Storage Emulator.
 *
 * Verifies:
 * 1. User Avatar owner upload, read, and delete
 * 2. Cross-user avatar write denial
 * 3. Unauthenticated avatar access denial
 * 4. Avatar size limit and MIME-type enforcement
 * 5. Public invoice PDF read
 * 6. Authorized company invoice PDF write
 * 7. Cross-company invoice PDF write denial
 * 8. CRM attachment tenant-isolated upload and read
 * 9. Cross-company CRM attachment read & write denial
 * 10. Task attachment tenant isolation
 * 11. Chat attachment tenant isolation
 * 12. Arbitrary wildcard upload denial (closes security hole)
 */

import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  ref,
  uploadBytes,
  getBytes,
  deleteObject,
} from "firebase/storage";
import { doc, setDoc } from "firebase/firestore";

const PROJECT_ID = "storage-rules-verification";

console.log("=======================================================");
console.log(" D-Arrow Business — Storage Security Rules Test Suite");
console.log("=======================================================\n");

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
  storage: { rules: readFileSync("storage.rules", "utf8") },
});

const results = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ PASS: ${name}`);
    results.push({ name, passed: true });
  } catch (err) {
    console.error(`✗ FAIL: ${name}`, err?.message || err);
    results.push({ name, passed: false, error: err?.message || String(err) });
  }
}

// Small valid test buffers
const sampleJpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const samplePdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]); // %PDF-1.5
const sampleExe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // MZ DOS/PE
const oversizedBuffer = new Uint8Array(6 * 1024 * 1024); // 6MB (exceeds 5MB avatar limit)

const CO_A = "company_alpha";
const CO_B = "company_beta";
const CO_C = "company_gamma";
const CO_D = "company_delta";

// Seed authentic Firestore user profiles (no custom claims)
await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await setDoc(doc(db, "users", "user_a"), {
    companyId: CO_A,
    role: "admin",
  });
  await setDoc(doc(db, "users", "user_b"), {
    companyId: CO_B,
    role: "admin",
  });
  await setDoc(doc(db, "users", "user_a_emp"), {
    companyId: CO_A,
    role: "employee",
  });
  await setDoc(doc(db, "users", "user_c"), {
    companyId: CO_C,
    role: "employee",
  });
  await setDoc(doc(db, "users", "user_d"), {
    companyId: CO_D,
    role: "employee",
  });
  // Company docs are the AUTHORITATIVE source the domain gate reads activity
  // from via a trusted server get — the client never supplies it.
  await setDoc(doc(db, "companies", CO_A), { name: "Alpha Clinic", primaryActivity: "MEDICAL_CLINIC" });
  await setDoc(doc(db, "companies", CO_B), { name: "Beta", primaryActivity: "PROJECTS" });
  await setDoc(doc(db, "companies", CO_C), { name: "Gamma Estates", primaryActivity: "REAL_ESTATE_MANAGEMENT" });
  await setDoc(doc(db, "companies", CO_D), { name: "Delta Agency", primaryActivity: "MARKETING_AGENCY" });
});

// Realistic authenticated contexts: standard Firebase Auth without synthetic claims
const userA = testEnv.authenticatedContext("user_a");
const userB = testEnv.authenticatedContext("user_b");
const userAEmp = testEnv.authenticatedContext("user_a_emp");
const userC = testEnv.authenticatedContext("user_c");
const userD = testEnv.authenticatedContext("user_d");
const unauth = testEnv.unauthenticatedContext();

const storageA = userA.storage();
const storageB = userB.storage();
const storageAEmp = userAEmp.storage();
const storageC = userC.storage();
const storageD = userD.storage();
const storageUnauth = unauth.storage();

// --- 1. User Avatars ---
await test("1. User A can upload own profile avatar (JPEG, <5MB)", async () => {
  const avatarRef = ref(storageA, "avatars/user_a/avatar.jpg");
  await assertSucceeds(uploadBytes(avatarRef, sampleJpg, { contentType: "image/jpeg" }));
});

await test("2. User A can read own profile avatar", async () => {
  const avatarRef = ref(storageA, "avatars/user_a/avatar.jpg");
  await assertSucceeds(getBytes(avatarRef));
});

await test("3. User B CANNOT overwrite User A's avatar", async () => {
  const avatarRef = ref(storageB, "avatars/user_a/avatar.jpg");
  await assertFails(uploadBytes(avatarRef, sampleJpg, { contentType: "image/jpeg" }));
});

await test("4. Unauthenticated user CANNOT upload avatar", async () => {
  const avatarRef = ref(storageUnauth, "avatars/user_a/avatar.jpg");
  await assertFails(uploadBytes(avatarRef, sampleJpg, { contentType: "image/jpeg" }));
});

await test("5. Oversized avatar (>5MB) is blocked", async () => {
  const avatarRef = ref(storageA, "avatars/user_a/avatar_huge.jpg");
  await assertFails(uploadBytes(avatarRef, oversizedBuffer, { contentType: "image/jpeg" }));
});

await test("6. Non-image file type for avatar is blocked", async () => {
  const avatarRef = ref(storageA, "avatars/user_a/avatar.exe");
  await assertFails(uploadBytes(avatarRef, sampleExe, { contentType: "application/x-msdownload" }));
});

await test("7. User A can delete own profile avatar", async () => {
  const avatarRef = ref(storageA, "avatars/user_a/avatar.jpg");
  await assertSucceeds(deleteObject(avatarRef));
});

// --- 2. Public Invoice PDFs ---
await test("8. Company A member can upload invoice PDF", async () => {
  const invRef = ref(storageA, `invoice-pdfs/${CO_A}/inv_001/share.pdf`);
  await assertSucceeds(uploadBytes(invRef, samplePdf, { contentType: "application/pdf" }));
});

await test("9. Anyone (unauthenticated) can read public invoice PDF", async () => {
  const invRef = ref(storageUnauth, `invoice-pdfs/${CO_A}/inv_001/share.pdf`);
  await assertSucceeds(getBytes(invRef));
});

await test("10. Company B user CANNOT write invoice PDF into Company A partition", async () => {
  const invRef = ref(storageB, `invoice-pdfs/${CO_A}/inv_002/share.pdf`);
  await assertFails(uploadBytes(invRef, samplePdf, { contentType: "application/pdf" }));
});

// --- 3. CRM Attachments ---
await test("11. Company A member can upload CRM attachment", async () => {
  const crmRef = ref(storageA, `crm/${CO_A}/deals/deal_100/proposal.pdf`);
  await assertSucceeds(uploadBytes(crmRef, samplePdf, { contentType: "application/pdf" }));
});

await test("12. Company A member can read CRM attachment", async () => {
  const crmRef = ref(storageA, `crm/${CO_A}/deals/deal_100/proposal.pdf`);
  await assertSucceeds(getBytes(crmRef));
});

await test("13. Company B member CANNOT read Company A CRM attachment", async () => {
  const crmRef = ref(storageB, `crm/${CO_A}/deals/deal_100/proposal.pdf`);
  await assertFails(getBytes(crmRef));
});

await test("14. Company B member CANNOT write CRM attachment to Company A", async () => {
  const crmRef = ref(storageB, `crm/${CO_A}/deals/deal_100/malicious.pdf`);
  await assertFails(uploadBytes(crmRef, samplePdf, { contentType: "application/pdf" }));
});

await test("15. Unauthenticated user CANNOT read CRM attachment", async () => {
  const crmRef = ref(storageUnauth, `crm/${CO_A}/deals/deal_100/proposal.pdf`);
  await assertFails(getBytes(crmRef));
});

// --- 4. Task Attachments ---
await test("16. Company A member can upload task attachment", async () => {
  const taskRef = ref(storageA, `tasks/${CO_A}/attachments/task_doc.pdf`);
  await assertSucceeds(uploadBytes(taskRef, samplePdf, { contentType: "application/pdf" }));
});

await test("17. Company B member CANNOT read Company A task attachment", async () => {
  const taskRef = ref(storageB, `tasks/${CO_A}/attachments/task_doc.pdf`);
  await assertFails(getBytes(taskRef));
});

// --- 5. Chat Attachments ---
await test("18. Company A member can upload chat attachment", async () => {
  const chatRef = ref(storageA, `chat/${CO_A}/conv_99/voice.pdf`);
  await assertSucceeds(uploadBytes(chatRef, samplePdf, { contentType: "application/pdf" }));
});

await test("19. Company B member CANNOT read Company A chat attachment", async () => {
  const chatRef = ref(storageB, `chat/${CO_A}/conv_99/voice.pdf`);
  await assertFails(getBytes(chatRef));
});

// --- 6. Arbitrary Wildcard Deny ---
await test("20. Arbitrary unmanaged path upload is BLOCKED for all users (wildcard sealed)", async () => {
  const leakRef = ref(storageA, `arbitrary_root/sensitive_dump.txt`);
  await assertFails(uploadBytes(leakRef, samplePdf, { contentType: "text/plain" }));
});

await test("21. Unauthenticated arbitrary read is BLOCKED", async () => {
  const leakRef = ref(storageUnauth, `arbitrary_root/sensitive_dump.txt`);
  await assertFails(getBytes(leakRef));
});

// --- 7. Deletion Authorization & Cross-Tenant Deletion Denial ---
await test("22. Company B member CANNOT delete Company A CRM attachment", async () => {
  const crmRef = ref(storageB, `crm/${CO_A}/deals/deal_100/proposal.pdf`);
  await assertFails(deleteObject(crmRef));
});

await test("23. Company A member can delete own CRM attachment", async () => {
  const crmRef = ref(storageA, `crm/${CO_A}/deals/deal_100/proposal.pdf`);
  await assertSucceeds(deleteObject(crmRef));
});

await test("24. Company B member CANNOT delete Company A task attachment", async () => {
  const taskRef = ref(storageB, `tasks/${CO_A}/attachments/task_doc.pdf`);
  await assertFails(deleteObject(taskRef));
});

// --- 8. Activity-owned domain attachments (Phase 2, §12 Storage parity) ---
// Path shape: domain/{collection}/{companyId}/... ; {collection} carries the
// reserved per-activity prefix. Access = tenant membership + the company's
// AUTHORITATIVE Firestore activity owns the prefix + (clinical/school) role.
await test("25. Privileged clinic admin CAN upload clinical domain attachment", async () => {
  const dRef = ref(storageA, `domain/cln_patients/${CO_A}/P1/scan.pdf`);
  await assertSucceeds(uploadBytes(dRef, samplePdf, { contentType: "application/pdf" }));
});

await test("26. Plain clinic employee CANNOT upload clinical domain attachment (least-privilege)", async () => {
  const dRef = ref(storageAEmp, `domain/cln_patients/${CO_A}/P2/scan.pdf`);
  await assertFails(uploadBytes(dRef, samplePdf, { contentType: "application/pdf" }));
});

await test("27. Plain clinic employee CANNOT read clinical domain attachment (least-privilege)", async () => {
  const dRef = ref(storageAEmp, `domain/cln_patients/${CO_A}/P1/scan.pdf`);
  await assertFails(getBytes(dRef));
});

await test("28. Clinic admin CAN read own clinical domain attachment", async () => {
  const dRef = ref(storageA, `domain/cln_patients/${CO_A}/P1/scan.pdf`);
  await assertSucceeds(getBytes(dRef));
});

await test("29. Real-estate member CAN upload non-sensitive domain attachment", async () => {
  const dRef = ref(storageC, `domain/rem_units/${CO_C}/U1/floor.pdf`);
  await assertSucceeds(uploadBytes(dRef, samplePdf, { contentType: "application/pdf" }));
});

await test("30. Real-estate tenant CANNOT upload clinical domain attachment (wrong activity)", async () => {
  const dRef = ref(storageC, `domain/cln_patients/${CO_C}/P1/scan.pdf`);
  await assertFails(uploadBytes(dRef, samplePdf, { contentType: "application/pdf" }));
});

await test("31. Clinic tenant CANNOT upload real-estate domain attachment (wrong activity)", async () => {
  const dRef = ref(storageAEmp, `domain/rem_units/${CO_A}/U1/floor.pdf`);
  await assertFails(uploadBytes(dRef, samplePdf, { contentType: "application/pdf" }));
});

await test("32. Outsider CANNOT upload into another company's domain partition", async () => {
  const dRef = ref(storageB, `domain/cln_patients/${CO_A}/HACK/x.pdf`);
  await assertFails(uploadBytes(dRef, samplePdf, { contentType: "application/pdf" }));
});

// Marketing Agency parity: briefs upload under domain/mkt_briefs/{companyId}/...
// — gated by the same prefix contract as the other live domains.
await test("33. Marketing member CAN upload mkt_briefs domain attachment", async () => {
  const dRef = ref(storageD, `domain/mkt_briefs/${CO_D}/C1/creative.pdf`);
  await assertSucceeds(uploadBytes(dRef, samplePdf, { contentType: "application/pdf" }));
});

await test("34. Marketing member CAN read the domain attachment back", async () => {
  const dRef = ref(storageD, `domain/mkt_briefs/${CO_D}/C1/creative.pdf`);
  await assertSucceeds(getBytes(dRef));
});

await test("35. Clinic tenant CANNOT upload marketing domain attachment (wrong activity)", async () => {
  const dRef = ref(storageAEmp, `domain/mkt_briefs/${CO_A}/C1/x.pdf`);
  await assertFails(uploadBytes(dRef, samplePdf, { contentType: "application/pdf" }));
});

await test("36. Marketing tenant CANNOT upload into the clinical domain (no cross-domain)", async () => {
  const dRef = ref(storageD, `domain/cln_patients/${CO_D}/P1/x.pdf`);
  await assertFails(uploadBytes(dRef, samplePdf, { contentType: "application/pdf" }));
});

await test("37. Outsider CANNOT read another company's marketing domain file", async () => {
  const dRef = ref(storageB, `domain/mkt_briefs/${CO_D}/C1/creative.pdf`);
  await assertFails(getBytes(dRef));
});

await testEnv.cleanup();

console.log("\n=======================================================");
const passed = results.filter((r) => r.passed).length;
const total = results.length;
console.log(` Storage Rules Test Summary: ${passed}/${total} passed`);
console.log("=======================================================");

if (passed < total) {
  process.exit(1);
}
