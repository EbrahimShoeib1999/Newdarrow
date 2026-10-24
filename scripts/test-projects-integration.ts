/**
 * D-Arrow Business — Projects Firestore-Emulator Integration Suite
 *
 * Exercises the PRODUCTION ProjectService / MilestoneService /
 * ProjectSettingsService against the local emulator with real security rules:
 * code sequencing, validated audited transitions, contract→project conversion
 * idempotency, preset retry-safety, terminology merge-writes, and tenant
 * isolation (cross-tenant writes must be denied server-side).
 *
 * Run: npx -y firebase-tools@13.35.1 emulators:exec --only firestore --project
 *      projects-integration-gate "npx tsx scripts/test-projects-integration.ts"
 */

// Connect production services to the emulator BEFORE any src/ import runs.
process.env.VITE_USE_FIREBASE_EMULATOR = "true";
process.env.VITE_FIREBASE_PROJECT_ID = "projects-integration-gate";

import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import type { SavedContract } from "../src/features/crm/types/contract.types";

const PROJECT_ID = "projects-integration-gate";
const CO = "company_projects_gate";
const CO_OTHER = "company_other_gate";

console.log("=================================================================");
console.log(" D-Arrow Business — Projects Emulator Integration Suite");
console.log("=================================================================\n");

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});

// Seed user profiles so belongsToCompany() rules evaluate for each actor.
// (users/admin_user and users/outsider_user here cover the fixed-uid contexts
// in section 6; the global service admin's dynamic uid is seeded after signup.)
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "users", "admin_user"), { companyId: CO, role: "admin" });
  await setDoc(doc(adminDb, "users", "member_user"), { companyId: CO, role: "employee" });
  await setDoc(doc(adminDb, "users", "outsider_user"), { companyId: CO_OTHER, role: "admin" });
});

// Production services share the global db, whose requests carry the current
// Firebase Auth session. We create a mock admin on the Auth emulator (repo
// convention: identitytoolkit signUp REST) and sign the global app in with it,
// so EVERY service call below is evaluated against the real firestore.rules as
// an authenticated, in-tenant admin — no rules bypass.
const { ProjectService, MilestoneService, UnitService } = await import(
  "../src/features/projects/api/projects.service"
);
const { ProjectSettingsService } = await import(
  "../src/features/projects/api/project-settings.service"
);
const { auth, db } = await import("../src/lib/firebase");
const { signInWithEmailAndPassword } = await import("firebase/auth");

const ADMIN_EMAIL = "admin@gate.local";
const ADMIN_PASS = "gate-pass-1";
const AUTH_ITK = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const su = await (await fetch(`${AUTH_ITK}/accounts:signUp?key=fake-key`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS, returnSecureToken: true }),
})).json();
if (!su.localId) {
  // Existing account from a persisted emulator session — resolve its uid via sign-in.
  const si = await (await fetch(`${AUTH_ITK}/accounts:signInWithPassword?key=fake-key`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS, returnSecureToken: true }),
  })).json();
  su.localId = si.localId;
  if (!su.localId) throw new Error(`Auth-emulator admin bootstrap failed: ${JSON.stringify(su)}`);
}
const SERVICE_UID = su.localId as string;
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), "users", SERVICE_UID), { companyId: CO, role: "admin" });
});
await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASS);
console.log(`Signed global service auth in as mock admin uid=${SERVICE_UID}\n`);

const runUnrestricted = <T>(fn: () => Promise<T>) => fn();

const results: { name: string; passed: boolean; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    results.push({ name, passed: true });
  } catch (err: any) {
    console.error(`  ✗ FAIL: ${name} — ${err?.message || String(err)}`);
    results.push({ name, passed: false, error: err?.message || String(err) });
  }
}

async function expectError(fn: () => Promise<unknown>, needle: string) {
  try {
    await fn();
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (!msg.includes(needle)) {
      throw new Error(`Expected error containing "${needle}", got: ${msg}`);
    }
    return;
  }
  throw new Error(`Expected error containing "${needle}", but call succeeded`);
}

const baseDTO = {
  name: "Gate Project",
  description: "",
  status: "planning" as const,
  members: ["admin_user"],
  createdBy: "admin_user",
  startDate: null,
  endDate: null,
};

function approvedContract(id: string, over?: Partial<SavedContract>): SavedContract {
  return {
    id,
    title: `Contract ${id}`,
    status: "final",
    approvalStatus: "approved",
    contactId: "ct_alpha",
    dealId: "deal_alpha",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    form: {
      title: `Contract ${id}`,
      contractNumber: `CNT-${id}`,
      contractDateIso: "2026-01-01",
      preamble: "",
      provider: { name: "D-Arrow" },
      client: { name: "Alpha Co" },
      fields: [
        { id: "f1", key: "amountExclVat", label: "", value: "50000" },
        { id: "f2", key: "vatRate", label: "", value: "15" },
      ],
      clauses: [],
      pageCount: "1",
      signatureDateIso: "2026-01-01",
      contactId: "ct_alpha",
      dealId: "deal_alpha",
    },
    ...over,
  } as SavedContract;
}

/* -------------------------------------------------------------------------- */
/* 1. Code sequence                                                            */
/* -------------------------------------------------------------------------- */
console.log("1. Project code sequence (tenant-scoped, never reused):");

await test("createProjectWithCode allocates PRJ-0001 then PRJ-0002 and persists the sequence", async () => {
  const r1 = await runUnrestricted(() => ProjectService.createProjectWithCode(CO, { ...baseDTO, name: "Seq One" }));
  const r2 = await runUnrestricted(() => ProjectService.createProjectWithCode(CO, { ...baseDTO, name: "Seq Two" }));
  if (r1.data.code !== "PRJ-0001") throw new Error(`first code expected PRJ-0001, got ${r1.data.code}`);
  if (r2.data.code !== "PRJ-0002") throw new Error(`second code expected PRJ-0002, got ${r2.data.code}`);
  const settingsSnap = await getDoc(doc(db, "companies", CO, "settings", "projects"));
  const next = settingsSnap.data()?.projectSequence?.nextNumber;
  if (next !== 3) throw new Error(`sequence nextNumber expected 3, got ${next}`);
});

await test("assignCodeIfMissing backfills legacy projects idempotently", async () => {
  const legacy = await runUnrestricted(() => ProjectService.createProject(CO, { ...baseDTO, name: "Legacy No Code" }));
  const legacyId = legacy.data.id;
  const first = await runUnrestricted(() => ProjectService.assignCodeIfMissing(CO, legacyId));
  const second = await runUnrestricted(() => ProjectService.assignCodeIfMissing(CO, legacyId));
  if (!first.data.code || !/^PRJ-\d{4}$/.test(first.data.code)) {
    throw new Error(`legacy project not coded: "${first.data.code}"`);
  }
  if (first.data.code !== second.data.code) {
    throw new Error(`re-assign changed the code: ${first.data.code} -> ${second.data.code}`);
  }
  await expectError(
    () => runUnrestricted(() => ProjectService.assignCodeIfMissing(CO, "nope_missing")),
    "project_not_found"
  );
});

/* -------------------------------------------------------------------------- */
/* 2. Validated audited transitions                                            */
/* -------------------------------------------------------------------------- */
console.log("\n2. Lifecycle transitions against real documents:");

await test("illegal transition throws and leaves the document untouched", async () => {
  const { data: p } = await runUnrestricted(() => ProjectService.createProject(CO, baseDTO));
  await expectError(
    () => runUnrestricted(() => ProjectService.transitionStatus(CO, p.id, "completed", "admin_user")),
    "invalid_transition:planning->completed"
  );
  const snap = await getDoc(doc(db, "companies", CO, "projects", p.id));
  if (snap.data()!.status !== "planning") throw new Error("status mutated by a rejected transition!");
  const history = snap.data()!.statusHistory;
  if (history !== undefined && history.length !== 0) throw new Error("history written by a rejected transition!");
});

await test("full audited path planning→active→on_hold→active→completed stamps dates, reasons, history", async () => {
  const { data: p } = await runUnrestricted(() => ProjectService.createProject(CO, baseDTO));
  const id = p.id;

  const started = await runUnrestricted(() => ProjectService.transitionStatus(CO, id, "active", "admin_user"));
  if (!started.data.actualStartDate) throw new Error("actualStartDate not stamped on start");
  if (started.data.statusHistory?.length !== 1 || started.data.statusHistory[0].by !== "admin_user") {
    throw new Error("start transition not audited");
  }

  await expectError(
    () => runUnrestricted(() => ProjectService.transitionStatus(CO, id, "on_hold", "admin_user")),
    "reason_required:pauseReason"
  );

  const held = await runUnrestricted(() => ProjectService.transitionStatus(CO, id, "on_hold", "admin_user", "  client delay  "));
  if (held.data.pauseReason !== "client delay") throw new Error(`pauseReason not stored: ${held.data.pauseReason}`);

  await runUnrestricted(() => ProjectService.transitionStatus(CO, id, "active", "admin_user"));
  const resumedSnap = await getDoc(doc(db, "companies", CO, "projects", id));
  if (resumedSnap.data()!.pauseReason !== null) throw new Error("pauseReason not cleared on resume");

  const done = await runUnrestricted(() => ProjectService.transitionStatus(CO, id, "completed", "admin_user"));
  if (!done.data.actualEndDate) throw new Error("actualEndDate not stamped on completion");
  if (done.data.statusHistory?.length !== 4) throw new Error(`expected 4 history entries, got ${done.data.statusHistory?.length}`);

  // Independent read-back of the persisted audit trail
  const finalSnap = await getDoc(doc(db, "companies", CO, "projects", id));
  const finalHistory = finalSnap.data()!.statusHistory as any[];
  const chain = finalHistory.map((h) => `${h.from}->${h.to}`).join(",");
  if (chain !== "planning->active,active->on_hold,on_hold->active,active->completed") {
    throw new Error(`unexpected persisted chain: ${chain}`);
  }

  await expectError(
    () => runUnrestricted(() => ProjectService.transitionStatus(CO, id, "cancelled", "admin_user")),
    "invalid_transition:completed->cancelled"
  );
});

await test("cancel requires reason and records cancellationReason", async () => {
  const { data: p } = await runUnrestricted(() => ProjectService.createProject(CO, baseDTO));
  await expectError(
    () => runUnrestricted(() => ProjectService.transitionStatus(CO, p.id, "cancelled", "admin_user")),
    "reason_required:cancellationReason"
  );
  const cancelled = await runUnrestricted(() => ProjectService.transitionStatus(CO, p.id, "cancelled", "admin_user", "deal fell through"));
  if (cancelled.data.cancellationReason !== "deal fell through") throw new Error("cancellationReason not stored");
  if (!cancelled.data.actualEndDate) throw new Error("actualEndDate not stamped on cancellation");
});

/* -------------------------------------------------------------------------- */
/* 3. Contract → project conversion                                            */
/* -------------------------------------------------------------------------- */
console.log("\n3. Contract→project conversion (retry-safe):");

await test("unapproved contract is refused", async () => {
  const draft = approvedContract("cn_unapproved", { approvalStatus: undefined });
  await expectError(
    () => runUnrestricted(() => ProjectService.createProjectFromContract(CO, draft, "admin_user")),
    "contract_not_approved"
  );
});

await test("double conversion returns the same project, carries references, allocates one code", async () => {
  const contract = approvedContract("cn_alpha");
  // Seed the authoritative contract document (audit trail stays on the contract).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "companies", CO, "contracts", contract.id), contract as any);
  });

  const seqBefore = await getDoc(doc(db, "companies", CO, "settings", "projects"));
  const nextBefore = seqBefore.data()?.projectSequence?.nextNumber;

  const first = await runUnrestricted(() => ProjectService.createProjectFromContract(CO, contract, "admin_user"));
  const second = await runUnrestricted(() => ProjectService.createProjectFromContract(CO, contract, "admin_user"));

  if (first.data.alreadyExisted !== false) throw new Error("first conversion must report a new project");
  if (second.data.alreadyExisted !== true) throw new Error("retry must report alreadyExisted");
  if (first.data.id !== second.data.id) throw new Error(`retry created a different doc: ${first.data.id} vs ${second.data.id}`);

  const projSnap = await getDoc(doc(db, "companies", CO, "projects", `from_contract_cn_alpha`));
  if (!projSnap.exists()) throw new Error("deterministic doc id from_contract_cn_alpha missing");
  const d = projSnap.data()!;
  if (d.contactId !== "ct_alpha" || d.dealId !== "deal_alpha" || d.contractId !== "cn_alpha") {
    throw new Error("commercial references not carried over");
  }
  if (d.conversionKey !== "contract:cn_alpha") throw new Error("idempotency key not stored");
  if (d.status !== "planning" || d.ownerId !== "admin_user") throw new Error("conversion defaults wrong");
  if (!/^PRJ-\d{4}$/.test(d.code)) throw new Error(`conversion did not allocate a code: ${d.code}`);

  const seqAfter = await getDoc(doc(db, "companies", CO, "settings", "projects"));
  const nextAfter = seqAfter.data()?.projectSequence?.nextNumber;
  if (nextAfter !== nextBefore + 1) {
    throw new Error(`retry consumed a second code: ${nextBefore} -> ${nextAfter}`);
  }

  // The original contract record is untouched by conversion
  const cSnap = await getDoc(doc(db, "companies", CO, "contracts", "cn_alpha"));
  if (cSnap.data()?.approvalStatus !== "approved") throw new Error("contract mutated during conversion");
});

/* -------------------------------------------------------------------------- */
/* 4. Milestones with deterministic preset ids                                 */
/* -------------------------------------------------------------------------- */
console.log("\n4. Milestone preset seeding retry-safety:");

await test("deterministic-id create never duplicates or overwrites edits", async () => {
  const { data: p } = await runUnrestricted(() => ProjectService.createProject(CO, baseDTO));
  const created = await runUnrestricted(() => MilestoneService.create(
    CO, p.id, { title: "Requirements & specification", status: "planned", sequenceOrder: 0 },
    "preset_software_0"
  ));
  if (created.data.title !== "Requirements & specification") throw new Error("preset milestone not created");

  await runUnrestricted(() => MilestoneService.update(CO, p.id, "preset_software_0", { title: "Renamed by user", status: "completed" }));

  // Simulated form re-submit (retry of the whole preset batch)
  await runUnrestricted(() => MilestoneService.create(
    CO, p.id, { title: "Requirements & specification", status: "planned", sequenceOrder: 0 },
    "preset_software_0"
  ));
  const snap = await getDoc(doc(db, "companies", CO, "projects", p.id, "milestones", "preset_software_0"));
  if (snap.data()!.title !== "Renamed by user") throw new Error("retry overwrote the user's edit!");
  if (snap.data()!.status !== "completed") throw new Error("retry reverted milestone status!");

  const list = await runUnrestricted(() => MilestoneService.list(CO, p.id));
  if (list.data.length !== 1) throw new Error(`duplicate milestone created (${list.data.length})`);
});

/* -------------------------------------------------------------------------- */
/* 4b. Real-estate units — persisted inventory + guarded lifecycle             */
/* -------------------------------------------------------------------------- */
console.log("\n4b. Real-estate unit lifecycle against real documents:");

const unitDTO = {
  code: "A-101",
  unitType: "apartment" as const,
  area: 90,
  price: 500000,
  currency: "SAR",
  status: "available" as const,
  buyerContactId: null,
};

await test("create + list a unit under the project, persisted with projectId stamped", async () => {
  const { data: p } = await runUnrestricted(() => ProjectService.createProject(CO, { ...baseDTO, activityType: "real_estate" }));
  const created = await runUnrestricted(() => UnitService.create(CO, p.id, unitDTO));
  if (created.data.code !== "A-101" || created.data.status !== "available") {
    throw new Error("unit not created as submitted");
  }
  const snap = await getDoc(doc(db, "companies", CO, "projects", p.id, "units", created.data.id));
  if (!snap.exists()) throw new Error("unit document not persisted");
  if (snap.data()!.projectId !== p.id) throw new Error("projectId not stamped on the unit");
  const list = await runUnrestricted(() => UnitService.list(CO, p.id));
  if (list.data.length !== 1) throw new Error(`expected 1 unit, got ${list.data.length}`);
});

await test("reserve stamps the buyer, then sell converts the reservation; history audited", async () => {
  const { data: p } = await runUnrestricted(() => ProjectService.createProject(CO, { ...baseDTO, activityType: "real_estate" }));
  const { data: u } = await runUnrestricted(() => UnitService.create(CO, p.id, unitDTO));

  const reserved = await runUnrestricted(() =>
    UnitService.changeStatus(CO, p.id, u.id, "reserved", "admin_user", { buyerContactId: "ct_buyer_1" })
  );
  if (reserved.data.status !== "reserved" || reserved.data.buyerContactId !== "ct_buyer_1") {
    throw new Error("reserve did not stamp buyer");
  }
  const sold = await runUnrestricted(() =>
    UnitService.changeStatus(CO, p.id, u.id, "sold", "admin_user", { contractId: "cnt_sale" })
  );
  if (sold.data.status !== "sold" || sold.data.contractId !== "cnt_sale") {
    throw new Error("sell did not carry the contract reference");
  }
  const finalSnap = await getDoc(doc(db, "companies", CO, "projects", p.id, "units", u.id));
  const hist = finalSnap.data()!.statusHistory as any[];
  const chain = hist.map((h) => `${h.from}->${h.to}`).join(",");
  if (chain !== "available->reserved,reserved->sold") throw new Error(`unexpected unit audit chain: ${chain}`);
});

await test("a committed unit cannot be double-reserved; sold is terminal", async () => {
  const { data: p } = await runUnrestricted(() => ProjectService.createProject(CO, { ...baseDTO, activityType: "real_estate" }));
  const { data: u } = await runUnrestricted(() => UnitService.create(CO, p.id, unitDTO));
  await runUnrestricted(() => UnitService.changeStatus(CO, p.id, u.id, "reserved", "admin_user", { buyerContactId: "ct_a" }));
  // Second reservation on an already-reserved unit must be rejected server-side.
  await expectError(
    () => runUnrestricted(() => UnitService.changeStatus(CO, p.id, u.id, "reserved", "admin_user", { buyerContactId: "ct_b" })),
    "invalid_transition:reserved->reserved"
  );
  await runUnrestricted(() => UnitService.changeStatus(CO, p.id, u.id, "sold", "admin_user"));
  await expectError(
    () => runUnrestricted(() => UnitService.changeStatus(CO, p.id, u.id, "available", "admin_user")),
    "invalid_transition:sold->available"
  );
});

await test("releasing a reservation back to available clears the buyer reference", async () => {
  const { data: p } = await runUnrestricted(() => ProjectService.createProject(CO, { ...baseDTO, activityType: "real_estate" }));
  const { data: u } = await runUnrestricted(() => UnitService.create(CO, p.id, unitDTO));
  await runUnrestricted(() => UnitService.changeStatus(CO, p.id, u.id, "reserved", "admin_user", { buyerContactId: "ct_x" }));
  const released = await runUnrestricted(() => UnitService.changeStatus(CO, p.id, u.id, "available", "admin_user", { note: "buyer walked" }));
  if (released.data.buyerContactId !== null) throw new Error("release did not clear buyer");
  const hist = released.data.statusHistory as any[];
  if (hist[hist.length - 1].note !== "buyer walked") throw new Error("release note not audited");
});

await test("outsider tenant cannot read or write another company's units", async () => {
  const outsiderDb = testEnv.authenticatedContext("outsider_user").firestore();
  // Resolve a real unit path owned by CO.
  const { data: p } = await runUnrestricted(() => ProjectService.createProject(CO, { ...baseDTO, activityType: "real_estate" }));
  const { data: u } = await runUnrestricted(() => UnitService.create(CO, p.id, unitDTO));
  let writeDenied = false;
  try {
    await setDoc(doc(outsiderDb, "companies", CO, "projects", p.id, "units", "hack"), { code: "X", status: "sold" });
  } catch (err: any) {
    writeDenied = String(err?.code || err?.message || "").includes("permission-denied");
  }
  if (!writeDenied) throw new Error("cross-tenant unit write was NOT denied");
  let readDenied = false;
  try {
    await getDoc(doc(outsiderDb, "companies", CO, "projects", p.id, "units", u.id));
  } catch (err: any) {
    readDenied = String(err?.code || err?.message || "").includes("permission-denied");
  }
  if (!readDenied) throw new Error("cross-tenant unit read was NOT denied");
});

/* -------------------------------------------------------------------------- */
/* 5. Tenant-scoped terminology                                                */
/* -------------------------------------------------------------------------- */
console.log("\n5. Terminology settings merge-writes:");

await test("updateTerminology preserves the code sequence; null reverts to defaults", async () => {
  const seqRef = doc(db, "companies", CO, "settings", "projects");
  const seqBefore = (await getDoc(seqRef)).data()?.projectSequence?.nextNumber;

  await runUnrestricted(() => ProjectSettingsService.updateTerminology(CO, {
    singular: { en: "Order", ar: "أمر" },
    plural: { en: "Orders", ar: "الأوامر" },
  }));
  let settings = (await getDoc(seqRef)).data();
  if (settings?.terminology?.singular?.en !== "Order") throw new Error("terminology not saved");
  if (settings?.projectSequence?.nextNumber !== seqBefore) throw new Error("terminology write clobbered the sequence!");

  await runUnrestricted(() => ProjectSettingsService.updateTerminology(CO, null));
  settings = (await getDoc(seqRef)).data();
  if (settings?.terminology !== undefined) throw new Error("revert did not delete terminology");
  if (settings?.projectSequence?.nextNumber !== seqBefore) throw new Error("revert clobbered the sequence!");

  // And the next code still continues the sequence
  const r = await runUnrestricted(() => ProjectService.createProjectWithCode(CO, { ...baseDTO, name: "Seq After Settings" }));
  if (r.data.code !== `PRJ-${String(seqBefore).padStart(4, "0")}`) {
    throw new Error(`sequence broken after settings write: ${r.data.code}`);
  }
});

/* -------------------------------------------------------------------------- */
/* 6. Server-side tenant isolation (real rules enforcement)                    */
/* -------------------------------------------------------------------------- */
console.log("\n6. Cross-tenant isolation enforced by security rules:");

await test("outsider company member cannot write into the tenant's projects collection", async () => {
  const outsiderCtx = testEnv.authenticatedContext("outsider_user");
  const outsiderDb = outsiderCtx.firestore();
  let denied = false;
  try {
    await setDoc(doc(outsiderDb, "companies", CO, "projects", "hack_doc"), { name: "intruder" });
  } catch (err: any) {
    denied = String(err?.code || err?.message || "").includes("permission-denied");
  }
  if (!denied) throw new Error("cross-tenant project write was NOT denied");
});

await test("outsider cannot read the tenant's project or settings documents", async () => {
  const outsiderCtx = testEnv.authenticatedContext("outsider_user");
  const outsiderDb = outsiderCtx.firestore();

  let settingsDenied = false;
  try {
    await getDoc(doc(outsiderDb, "companies", CO, "settings", "projects"));
    throw new Error(`cross-tenant read of settings allowed`);
  } catch (err: any) {
    if (!String(err?.code || err?.message || "").includes("permission-denied")) throw err;
    settingsDenied = true;
  }
  if (!settingsDenied) throw new Error("settings read not denied");

  let projectDenied = false;
  try {
    await getDoc(doc(outsiderDb, "companies", CO, "projects", "from_contract_cn_alpha"));
    throw new Error(`cross-tenant read of project allowed`);
  } catch (err: any) {
    if (!String(err?.code || err?.message || "").includes("permission-denied")) throw err;
    projectDenied = true;
  }
  if (!projectDenied) throw new Error("project read not denied");
});

await test("unauthenticated access to company subcollections is denied", async () => {
  const anonDb = testEnv.unauthenticatedContext().firestore();
  let denied = false;
  try {
    await getDoc(doc(anonDb, "companies", CO, "settings", "projects"));
  } catch (err: any) {
    denied = String(err?.code || err?.message || "").includes("permission-denied");
  }
  if (!denied) throw new Error("unauthenticated read was NOT denied");
});

await test("same-company member can read the tenant settings doc (positive control)", async () => {
  const memberCtx = testEnv.authenticatedContext("member_user");
  const memberDb = memberCtx.firestore();
  const snap = await getDoc(doc(memberDb, "companies", CO, "settings", "projects"));
  if (!snap.exists()) throw new Error("in-tenant member could not read settings doc");
});

/* -------------------------------------------------------------------------- */
/* Summary                                                                     */
/* -------------------------------------------------------------------------- */
await testEnv.cleanup();

console.log("\n=================================================================");
const passed = results.filter((r) => r.passed).length;
console.log(` Projects Integration Summary: ${passed}/${results.length} passed, ${results.length - passed} failed`);
console.log("=================================================================\n");
process.exit(passed === results.length ? 0 : 1);
