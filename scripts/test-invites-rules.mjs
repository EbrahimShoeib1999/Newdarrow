import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

const projectId = "darrow-invites-rules";
const companyA = "company-a";
const companyB = "company-b";
const future = Timestamp.fromDate(new Date(Date.now() + 60 * 60 * 1000));
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});
const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({
      name,
      passed: false,
      message: error instanceof Error ? error.message : String(error),
    });
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function inviteData(token, companyId, role = "employee") {
  return {
    token,
    email: `${token}@example.test`,
    companyId,
    companyName: companyId,
    invitedBy: "admin-a",
    invitedByName: "Admin",
    role,
    status: "pending",
    createdAt: Timestamp.now(),
    expiresAt: future,
    portalAccess: [],
    portalSubRoles: {},
  };
}

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "admin-a"), {
      id: "admin-a",
      companyId: companyA,
      role: "admin",
      onboardingStatus: "active",
    });
    await setDoc(doc(db, "users", "admin-b"), {
      id: "admin-b",
      companyId: companyB,
      role: "admin",
      onboardingStatus: "active",
    });
    await setDoc(doc(db, "users", "hr-a"), {
      id: "hr-a",
      companyId: companyA,
      role: "global_hr_manager",
      onboardingStatus: "active",
    });
    await setDoc(doc(db, "users", "employee-a"), {
      id: "employee-a",
      companyId: companyA,
      role: "employee",
      onboardingStatus: "active",
    });
    await setDoc(doc(db, "invites", "company-b-existing"), inviteData("company-b-existing", companyB));
    await setDoc(doc(db, "invites", "hr-manager-existing"), inviteData("hr-manager-existing", companyA, "manager"));
  });

  const admin = env.authenticatedContext("admin-a").firestore();
  const tenantBAdmin = env.authenticatedContext("admin-b").firestore();
  const hr = env.authenticatedContext("hr-a").firestore();
  const employee = env.authenticatedContext("employee-a").firestore();
  const platformAdmin = env.authenticatedContext("platform-admin", {
    role: "platform_admin",
  }).firestore();

  await check("company admin creates allowed invite roles", async () => {
    for (const role of ["employee", "viewer", "manager", "global_hr_manager"]) {
      const token = `admin-create-${role}`;
      await assertSucceeds(setDoc(doc(admin, "invites", token), inviteData(token, companyA, role)));
    }
  });

  await check("company admin lists only its company pending invites", async () => {
    const snapshot = await assertSucceeds(
      getDocs(query(
        collection(admin, "invites"),
        where("companyId", "==", companyA),
        where("status", "==", "pending")
      ))
    );
    assert.ok(snapshot.docs.length >= 4);
    assert.ok(snapshot.docs.every((item) => item.data().companyId === companyA));
  });

  await check("company admin revokes a same-company pending invitation", async () => {
    const inviteRef = doc(admin, "invites", "admin-create-manager");
    await assertSucceeds(deleteDoc(inviteRef));
    await env.withSecurityRulesDisabled(async (context) => {
      const deleted = await getDoc(doc(context.firestore(), "invites", "admin-create-manager"));
      assert.equal(deleted.exists(), false);
    });
  });

  await check("restricted and invalid invitation roles are denied by rules", async () => {
    await assertFails(setDoc(
      doc(admin, "invites", "restricted-admin"),
      inviteData("restricted-admin", companyA, "admin")
    ));
    await assertFails(setDoc(
      doc(admin, "invites", "invalid-role"),
      inviteData("invalid-role", companyA, "invalid-role")
    ));
  });

  await check("platform admin can create, list, and revoke an allowed invite", async () => {
    const token = "platform-admin-invite";
    await assertSucceeds(setDoc(doc(platformAdmin, "invites", token), inviteData(token, companyA)));
    await assertSucceeds(getDocs(query(
      collection(platformAdmin, "invites"),
      where("companyId", "==", companyA),
      where("status", "==", "pending")
    )));
    await assertSucceeds(deleteDoc(doc(platformAdmin, "invites", token)));
  });

  await check("same-company employee cannot create, list, or revoke invites", async () => {
    await assertFails(setDoc(
      doc(employee, "invites", "employee-create"),
      inviteData("employee-create", companyA)
    ));
    await assertFails(getDocs(query(
      collection(employee, "invites"),
      where("companyId", "==", companyA),
      where("status", "==", "pending")
    )));
    await assertFails(deleteDoc(doc(employee, "invites", "hr-manager-existing")));
  });

  await check("Global HR can manage only employee/viewer invitations", async () => {
    for (const role of ["employee", "viewer"]) {
      const token = `hr-create-${role}`;
      await assertSucceeds(setDoc(doc(hr, "invites", token), inviteData(token, companyA, role)));
      await assertSucceeds(deleteDoc(doc(hr, "invites", token)));
    }
    await assertFails(setDoc(
      doc(hr, "invites", "hr-create-manager"),
      inviteData("hr-create-manager", companyA, "manager")
    ));
    await assertFails(deleteDoc(doc(hr, "invites", "hr-manager-existing")));
  });

  await check("tenant A admin cannot list, update, or revoke tenant B invitations", async () => {
    await assertFails(getDocs(query(
      collection(admin, "invites"),
      where("companyId", "==", companyB),
      where("status", "==", "pending")
    )));
    await assertFails(updateDoc(doc(admin, "invites", "company-b-existing"), {
      status: "revoked",
    }));
    await assertFails(deleteDoc(doc(admin, "invites", "company-b-existing")));
    const tenantBList = await assertSucceeds(getDocs(query(
      collection(tenantBAdmin, "invites"),
      where("companyId", "==", companyB),
      where("status", "==", "pending")
    )));
    assert.equal(tenantBList.size, 1);
  });

  const failed = results.filter((result) => !result.passed);
  console.log(`\n${results.length - failed.length}/${results.length} emulator scenarios passed`);
  if (failed.length) process.exitCode = 1;
} finally {
  await env.cleanup();
}
