import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeApp, deleteApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  Timestamp,
  collection,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { acceptInvitationForUser } from "../src/features/auth/api/invitation-onboarding";

const PROJECT_ID = "darrow-invitation-onboarding";
const COMPANY_ID = "darrow";
const rules = readFileSync("firestore.rules", "utf8");
const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules, host: "127.0.0.1", port: 8080 },
});
const authApp = initializeApp(
  { apiKey: "emulator-api-key", projectId: PROJECT_ID, authDomain: "localhost" },
  "invitation-onboarding-emulator"
);
const auth = getAuth(authApp);
const authFirestore = getFirestore(authApp);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
connectFirestoreEmulator(authFirestore, "127.0.0.1", 8080);

let passed = 0;
const cases: Array<{ name: string; run: () => Promise<void> }> = [];

function test(name: string, run: () => Promise<void>) {
  cases.push({ name, run });
}

async function seedInvite(input: {
  token: string;
  email: string;
  employeeId?: string;
  status?: string;
  expiresAt?: Timestamp;
  companyId?: string;
  role?: string;
}) {
  const companyId = input.companyId ?? COMPANY_ID;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, "invites", input.token), {
      token: input.token,
      email: input.email,
      companyId,
      companyName: "DArrow",
      role: input.role ?? "employee",
      status: input.status ?? "pending",
      expiresAt:
        input.expiresAt ??
        Timestamp.fromDate(new Date(Date.now() + 60 * 60 * 1000)),
      portalAccess: [],
      portalSubRoles: {},
      ...(input.employeeId ? { employeeId: input.employeeId } : {}),
    });
  });
}

async function seedEmployee(input: {
  id: string;
  email: string;
  companyId?: string;
  role?: string;
  userId?: string;
  country?: string;
  workMode?: string;
}) {
  const companyId = input.companyId ?? COMPANY_ID;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), "companies", companyId, "employees", input.id),
      {
        id: input.id,
        userId: input.userId ?? "",
        companyId,
        email: input.email,
        role: input.role ?? "employee",
        status: "active",
        country: input.country ?? "Egypt",
        workMode: input.workMode ?? "remote",
        firstName: "DArrow",
        lastName: "Employee",
      }
    );
  });
}

async function seedUser(input: {
  uid: string;
  email: string;
  companyId?: string;
  role?: string;
}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", input.uid), {
      id: input.uid,
      email: input.email,
      name: "Existing Account",
      role: input.role ?? "employee",
      companyId: input.companyId ?? "",
      companyName: input.companyId ? "Other Tenant" : "",
      customPermissions: [],
      portalAccess: [],
      portalSubRoles: {},
    });
  });
}

async function accept(uid: string, email: string, token: string) {
  const firestore = testEnv.authenticatedContext(uid, { email }).firestore();
  return acceptInvitationForUser(
    firestore,
    {
      uid,
      email,
      displayName: "Existing Account",
      photoURL: null,
    },
    token
  );
}

async function adminGet(path: string) {
  let result: Awaited<ReturnType<typeof getDoc>> | undefined;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    result = await getDoc(doc(context.firestore(), path));
  });
  return result!;
}

test("A. New Gmail identity links the employee without creating a company", async () => {
  const email = "new.employee@gmail.com";
  await seedEmployee({
    id: "hire-record-gmail",
    email,
    country: "Saudi Arabia",
    workMode: "office",
  });
  await seedInvite({
    token: "invite-new-gmail",
    email,
    employeeId: "hire-record-gmail",
  });

  const credential = await createUserWithEmailAndPassword(
    auth,
    email,
    "Emulator-Test-Password-104!"
  );
  const uid = credential.user.uid;
  const user = await acceptInvitationForUser(
    authFirestore,
    credential.user,
    "invite-new-gmail"
  );
  assert.equal(user.id, uid);
  assert.equal(user.companyId, COMPANY_ID);
  assert.equal(user.role, "employee");
  const profile = await adminGet(`users/${uid}`);
  const employee = await adminGet(
    `companies/${COMPANY_ID}/employees/hire-record-gmail`
  );
  const invite = await adminGet("invites/invite-new-gmail");
  assert.equal(profile.data()?.id, uid);
  assert.equal(profile.data()?.onboardingStatus, "active");
  assert.equal(employee.data()?.userId, uid);
  assert.equal(employee.data()?.country, "Saudi Arabia");
  assert.equal(employee.data()?.workMode, "office");
  assert.equal(invite.data()?.status, "accepted");
  assert.equal(invite.data()?.acceptedBy, uid);
  let companyCount = 0;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    companyCount = (await getDocs(collection(context.firestore(), "companies"))).size;
  });
  assert.equal(companyCount, 2);
  await signOut(auth);
});

test("B. Existing Gmail Auth UID is preserved and linked", async () => {
  const email = "existing.account@gmail.com";
  const created = await createUserWithEmailAndPassword(
    auth,
    email,
    "Emulator-Test-Password-104!"
  );
  const uid = created.user.uid;
  await signOut(auth);
  await seedUser({ uid, email });
  await seedEmployee({ id: "existing-gmail-employee", email });
  await seedInvite({ token: "invite-existing-gmail", email });

  const credential = await signInWithEmailAndPassword(
    auth,
    email,
    "Emulator-Test-Password-104!"
  );
  const accepted = await acceptInvitationForUser(
    authFirestore,
    credential.user,
    "invite-existing-gmail"
  );
  assert.equal(accepted.id, uid);
  assert.equal((await adminGet(`users/${uid}`)).data()?.id, uid);
  assert.equal(
    (await adminGet(`companies/${COMPANY_ID}/employees/existing-gmail-employee`))
      .data()?.userId,
    uid
  );
  await signOut(auth);
});

test("C. Existing Outlook Auth UID is preserved and linked", async () => {
  const email = "existing.account@outlook.com";
  const created = await createUserWithEmailAndPassword(
    auth,
    email,
    "Emulator-Test-Password-104!"
  );
  const uid = created.user.uid;
  await signOut(auth);
  await seedUser({ uid, email });
  await seedEmployee({ id: "existing-outlook-employee", email });
  await seedInvite({ token: "invite-existing-outlook", email });

  const credential = await signInWithEmailAndPassword(
    auth,
    email,
    "Emulator-Test-Password-104!"
  );
  const accepted = await acceptInvitationForUser(
    authFirestore,
    credential.user,
    "invite-existing-outlook"
  );
  assert.equal(accepted.id, uid);
  assert.equal((await adminGet(`users/${uid}`)).data()?.email, email);
  assert.equal(
    (await adminGet(`companies/${COMPANY_ID}/employees/existing-outlook-employee`))
      .data()?.userId,
    uid
  );
  await signOut(auth);
});

test("D. Existing account in another company cannot be transferred", async () => {
  const uid = "foreign-company-uid";
  const email = "foreign.employee@gmail.com";
  await seedUser({ uid, email, companyId: "other-tenant" });
  await seedEmployee({
    id: "foreign-employee-record",
    email,
    companyId: "other-tenant",
    userId: uid,
  });
  await seedInvite({ token: "invite-foreign", email });
  await assert.rejects(accept(uid, email, "invite-foreign"), /COMPANY_CONFLICT/);
  assert.equal((await adminGet(`users/${uid}`)).data()?.companyId, "other-tenant");
  assert.equal(
    (await adminGet("companies/other-tenant/employees/foreign-employee-record"))
      .data()?.userId,
    uid
  );
  assert.equal((await adminGet("invites/invite-foreign")).data()?.status, "pending");
});

test("E. Expired invitation is denied by rules and service validation", async () => {
  const email = "expired.employee@gmail.com";
  await seedInvite({
    token: "invite-expired",
    email,
    expiresAt: Timestamp.fromDate(new Date(Date.now() - 60_000)),
  });
  const firestore = testEnv
    .authenticatedContext("expired-uid", { email })
    .firestore();
  await assert.rejects(
    getDoc(doc(firestore, "invites", "invite-expired")),
    /permission-denied/
  );
});

test("F. Already-accepted invitation cannot be reused", async () => {
  const email = "accepted.employee@gmail.com";
  await seedInvite({ token: "invite-accepted", email, status: "accepted" });
  const firestore = testEnv
    .authenticatedContext("accepted-uid", { email })
    .firestore();
  await assert.rejects(
    getDoc(doc(firestore, "invites", "invite-accepted")),
    /permission-denied/
  );
});

test("G. Wrong authenticated email cannot accept another person's invitation", async () => {
  await seedInvite({
    token: "invite-wrong-email",
    email: "right.person@gmail.com",
  });
  await assert.rejects(
    accept("wrong-email-uid", "wrong.person@gmail.com", "invite-wrong-email"),
    /permission-denied|INVITE_EMAIL_MISMATCH/
  );
  assert.equal(
    (await adminGet("invites/invite-wrong-email")).data()?.status,
    "pending"
  );
});

test("H. Forged companyId is rejected by profile rules", async () => {
  const uid = "forged-company-uid";
  const email = "forged.company@gmail.com";
  await seedInvite({ token: "invite-forged-company", email });
  const firestore = testEnv.authenticatedContext(uid, { email }).firestore();
  await assert.rejects(
    setDoc(doc(firestore, "users", uid), {
      id: uid,
      email,
      companyId: "other-tenant",
      companyName: "Other Tenant",
      role: "employee",
      invitationToken: "invite-forged-company",
      onboardingStatus: "pending",
      portalAccess: [],
      portalSubRoles: {},
      customPermissions: [],
    }),
    /permission-denied/
  );
});

test("I. Forged role is rejected even when the invitation token is valid", async () => {
  const uid = "forged-role-uid";
  const email = "forged.role@gmail.com";
  await seedInvite({ token: "invite-forged-role", email, role: "employee" });
  const firestore = testEnv.authenticatedContext(uid, { email }).firestore();
  await assert.rejects(
    setDoc(doc(firestore, "users", uid), {
      id: uid,
      email,
      companyId: COMPANY_ID,
      companyName: "DArrow",
      role: "admin",
      invitationToken: "invite-forged-role",
      onboardingStatus: "pending",
      portalAccess: [],
      portalSubRoles: {},
      customPermissions: [],
    }),
    /permission-denied/
  );
});

test("J. Missing employee record is created once at the authenticated UID", async () => {
  const uid = "new-without-employee-uid";
  const email = "new.without.employee@gmail.com";
  await seedInvite({ token: "invite-no-employee", email });
  const accepted = await accept(uid, email, "invite-no-employee");
  assert.equal(accepted.id, uid);
  assert.equal(
    (await adminGet(`companies/${COMPANY_ID}/employees/${uid}`)).exists(),
    true
  );
  const employees = await adminGet(`companies/${COMPANY_ID}`);
  assert.equal(employees.data()?.name, "DArrow");
});

test("K. Existing employee record is linked without creating a duplicate", async () => {
  const uid = "single-record-uid";
  const email = "single.record@gmail.com";
  await seedEmployee({ id: "single-existing-record", email });
  await seedInvite({ token: "invite-single-record", email });
  await accept(uid, email, "invite-single-record");

  const firestore = testEnv
    .authenticatedContext(uid, { email })
    .firestore();
  const matches = await getDocs(
    query(
      collection(firestore, "companies", COMPANY_ID, "employees"),
      where("email", "==", email)
    )
  );
  assert.equal(matches.size, 1);
  assert.equal(matches.docs[0].id, "single-existing-record");
});

test("L. Attendance initialization reads work after successful acceptance", async () => {
  const uid = "attendance-uid";
  const email = "attendance.employee@gmail.com";
  await seedEmployee({ id: "attendance-employee", email });
  await seedInvite({
    token: "invite-attendance",
    email,
    employeeId: "attendance-employee",
  });
  await accept(uid, email, "invite-attendance");

  const firestore = testEnv.authenticatedContext(uid, { email }).firestore();
  const employees = await getDocs(
    query(
      collection(firestore, "companies", COMPANY_ID, "employees"),
      where("userId", "==", uid)
    )
  );
  assert.equal(employees.size, 1);
  assert.equal(employees.docs[0].id, "attendance-employee");
  const attendance = await getDocs(
    query(
      collection(firestore, "companies", COMPANY_ID, "attendance"),
      where("employeeId", "==", employees.docs[0].id)
    )
  );
  assert.equal(attendance.empty, true);
});

test("M. Normal employee cannot list every company", async () => {
  await seedUser({
    uid: "normal-company-employee",
    email: "normal.employee@gmail.com",
    companyId: COMPANY_ID,
  });
  const firestore = testEnv
    .authenticatedContext("normal-company-employee", {
      email: "normal.employee@gmail.com",
    })
    .firestore();
  await assert.rejects(getDocs(collection(firestore, "companies")), /permission-denied/);
});

test("N. Platform administrator can list companies", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "companies", COMPANY_ID), {
      name: "DArrow",
    });
    await setDoc(doc(context.firestore(), "companies", "other-tenant"), {
      name: "Other Tenant",
    });
  });
  const firestore = testEnv
    .authenticatedContext("platform-admin-uid", { role: "platform_admin" })
    .firestore();
  const companies = await getDocs(collection(firestore, "companies"));
  assert.equal(companies.size, 2);
});

test("O. Company administrator can retrieve their own company document", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, "companies", COMPANY_ID), { name: "DArrow" });
    await setDoc(doc(firestore, "users", "company-admin-uid"), {
      id: "company-admin-uid",
      email: "admin@darrow.com",
      companyId: COMPANY_ID,
      role: "admin",
    });
  });
  const firestore = testEnv
    .authenticatedContext("company-admin-uid", { email: "admin@darrow.com" })
    .firestore();
  assert.equal(
    (await getDoc(doc(firestore, "companies", COMPANY_ID))).data()?.name,
    "DArrow"
  );
});

test("P. The previous direct employee-link update is denied", async () => {
  const uid = "legacy-linking-uid";
  const email = "legacy.linking@gmail.com";
  await seedUser({ uid, email, companyId: COMPANY_ID });
  await seedEmployee({ id: "legacy-linking-employee", email });
  const firestore = testEnv.authenticatedContext(uid, { email }).firestore();
  await assert.rejects(
    updateDoc(
      doc(
        firestore,
        "companies",
        COMPANY_ID,
        "employees",
        "legacy-linking-employee"
      ),
      { userId: uid, updatedAt: serverTimestamp() }
    ),
    /permission-denied/
  );
  assert.equal(
    (await adminGet(`companies/${COMPANY_ID}/employees/legacy-linking-employee`))
      .data()?.userId,
    ""
  );
});

test("Q. A claimed employee cannot be taken over; the invited account can retry after authorized repair", async () => {
  const email = "claimed.employee@outlook.com";
  const credential = await createUserWithEmailAndPassword(
    auth,
    email,
    "Emulator-Test-Password-104!"
  );
  const uid = credential.user.uid;
  const priorUid = "prior-employee-owner-uid";
  await seedUser({ uid, email, companyId: COMPANY_ID });
  await seedEmployee({
    id: "already-claimed-employee",
    email,
    userId: priorUid,
  });
  await seedInvite({
    token: "invite-claimed-record",
    email,
    employeeId: "already-claimed-employee",
  });

  await assert.rejects(
    updateDoc(
      doc(
        authFirestore,
        "companies",
        COMPANY_ID,
        "employees",
        "already-claimed-employee"
      ),
      { userId: uid }
    ),
    /permission-denied/
  );
  await assert.rejects(
    acceptInvitationForUser(
      authFirestore,
      credential.user,
      "invite-claimed-record"
    ),
    /INVITE_EMPLOYEE_MISMATCH/
  );
  assert.equal(
    (await adminGet(`companies/${COMPANY_ID}/employees/already-claimed-employee`))
      .data()?.userId,
    priorUid
  );
  assert.equal(
    (await adminGet("invites/invite-claimed-record")).data()?.status,
    "pending"
  );
  assert.equal((await adminGet(`users/${uid}`)).data()?.onboardingStatus, "pending");

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(
      doc(
        context.firestore(),
        "companies",
        COMPANY_ID,
        "employees",
        "already-claimed-employee"
      ),
      { userId: "" }
    );
  });
  const accepted = await acceptInvitationForUser(
    authFirestore,
    credential.user,
    "invite-claimed-record"
  );
  assert.equal(accepted.id, uid);
  assert.equal(
    (await adminGet(`companies/${COMPANY_ID}/employees/already-claimed-employee`))
      .data()?.userId,
    uid
  );
  assert.equal(
    (await adminGet("invites/invite-claimed-record")).data()?.status,
    "accepted"
  );
  await signOut(auth);
});

test("R. A pending invitee cannot activate their profile without atomic completion", async () => {
  const uid = "pending-self-activation-uid";
  const email = "pending.activation@gmail.com";
  await seedInvite({ token: "invite-pending-activation", email });
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", uid), {
      id: uid,
      email,
      name: "Pending Invitee",
      role: "employee",
      companyId: COMPANY_ID,
      companyName: "DArrow",
      invitationToken: "invite-pending-activation",
      onboardingStatus: "pending",
      customPermissions: [],
      portalAccess: [],
      portalSubRoles: {},
    });
  });

  const firestore = testEnv.authenticatedContext(uid, { email }).firestore();
  await assert.rejects(
    updateDoc(doc(firestore, "users", uid), {
      onboardingStatus: "active",
    }),
    /permission-denied/
  );
  assert.equal((await adminGet(`users/${uid}`)).data()?.onboardingStatus, "pending");
  assert.equal(
    (await adminGet("invites/invite-pending-activation")).data()?.status,
    "pending"
  );
});

test("S. An ordinary employee cannot self-grant portal access", async () => {
  const uid = "portal-escalation-uid";
  const email = "portal.escalation@gmail.com";
  await seedUser({ uid, email, companyId: COMPANY_ID });
  const firestore = testEnv.authenticatedContext(uid, { email }).firestore();
  await assert.rejects(
    updateDoc(doc(firestore, "users", uid), { portalAccess: ["billing"] }),
    /permission-denied/
  );
  assert.deepEqual((await adminGet(`users/${uid}`)).data()?.portalAccess, []);
});

try {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, "companies", COMPANY_ID), { name: "DArrow" });
    await setDoc(doc(firestore, "companies", "other-tenant"), {
      name: "Other Tenant",
    });
  });

  for (const testCase of cases) {
    try {
      await testCase.run();
      passed += 1;
      console.log(`PASS ${testCase.name}`);
    } catch (error) {
      console.error(`FAIL ${testCase.name}`);
      console.error(error);
    }
  }

  console.log(`RESULT ${passed}/${cases.length} Firestore Emulator cases passed`);
  assert.equal(passed, cases.length, "One or more emulator integration cases failed");
} finally {
  await signOut(auth).catch(() => undefined);
  await deleteApp(authApp);
  await testEnv.cleanup();
}
