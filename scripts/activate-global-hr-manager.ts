import { promises as fs } from "node:fs";
import path from "node:path";

const TARGET_EMAIL = process.env.DARROW_TARGET_EMAIL || "khulodahmed390@gmail.com";
const TARGET_ROLE = "global_hr_manager";
const TARGET_COUNTRY_SCOPE = ["EG", "SA"];

async function main() {
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;

  if (!credentialPath) {
    console.error("Missing GOOGLE_APPLICATION_CREDENTIALS. Firebase Admin SDK authentication is not configured in this environment.");
    console.error("Manual setup: export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json and ensure the project has access to the target Firebase project.");
    process.exitCode = 1;
    return;
  }

  const resolvedPath = path.resolve(credentialPath);
  try {
    await fs.access(resolvedPath);
  } catch {
    console.error(`Service account file not found: ${resolvedPath}`);
    process.exitCode = 1;
    return;
  }

  const admin = await import("firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId,
    });
  }

  const auth = admin.getAuth();
  const db = admin.firestore();

  const userRecord = await auth.getUserByEmail(TARGET_EMAIL);
  const userDocRef = db.collection("users").doc(userRecord.uid);
  const userSnap = await userDocRef.get();
  if (!userSnap.exists) {
    throw new Error(`No Firestore user profile found for uid ${userRecord.uid} (${TARGET_EMAIL})`);
  }

  const currentUser = userSnap.data() ?? {};
  const currentCompanyId = currentUser.companyId ?? "";
  const existingCountryScope = Array.isArray(currentUser.countryScope) ? currentUser.countryScope : [];

  if (!currentCompanyId) {
    throw new Error(`User ${TARGET_EMAIL} is missing companyId; refusing to assign a tenant-scoped role.`);
  }

  const companyRef = db.collection("companies").doc(currentCompanyId);
  const companySnap = await companyRef.get();
  if (!companySnap.exists) {
    throw new Error(`Company ${currentCompanyId} does not exist; refusing to update role assignment.`);
  }

  const company = companySnap.data() ?? {};
  const branches = await companyRef.collection("branches").get();
  const branchCountryCodes = new Set<string>();
  for (const branch of branches.docs) {
    const data = branch.data() as Record<string, unknown>;
    const branchCountry = typeof data.country === "string" ? data.country.trim().toUpperCase() : "";
    if (branchCountry) branchCountryCodes.add(branchCountry);
  }

  const countryScope = Array.from(new Set([...TARGET_COUNTRY_SCOPE, ...existingCountryScope]));
  const invalidTarget = countryScope.filter((country) => !["EG", "SA"].includes(country));
  if (invalidTarget.length) {
    throw new Error(`Target country scope contains unsupported values: ${invalidTarget.join(", ")}`);
  }

  const customClaims = {
    ...(userRecord.customClaims ?? {}),
    role: TARGET_ROLE,
    countryScope,
    companyId: currentCompanyId,
  };

  const updatePayload = {
    ...currentUser,
    role: TARGET_ROLE,
    companyId: currentCompanyId,
    countryScope,
    updatedAt: new Date().toISOString(),
  };

  if (process.env.DRY_RUN === "true") {
    console.log(JSON.stringify({
      targetEmail: TARGET_EMAIL,
      uid: userRecord.uid,
      companyId: currentCompanyId,
      customClaims,
      firestoreUpdate: updatePayload,
      branchCountries: Array.from(branchCountryCodes),
    }, null, 2));
    return;
  }

  await auth.setCustomUserClaims(userRecord.uid, customClaims);
  await userDocRef.set(updatePayload, { merge: true });

  console.log(JSON.stringify({
    updated: true,
    targetEmail: TARGET_EMAIL,
    uid: userRecord.uid,
    companyId: currentCompanyId,
    role: TARGET_ROLE,
    countryScope,
  }, null, 2));
}

main().catch((error) => {
  console.error("Activation failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
