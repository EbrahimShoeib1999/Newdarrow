import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { promises as fs } from "node:fs";
import path from "node:path";

const TARGET_EMAIL = process.env.DARROW_TARGET_EMAIL || "khulodahmed390@gmail.com";
const TARGET_ROLE = "global_hr_manager";
const TARGET_COUNTRY_SCOPE = ["EG", "SA"];
const ACTION = process.env.ACTION || "activate"; // "activate" | "rollback" | "status"
const DEFAULT_SNAPSHOT_DIR = path.resolve(process.cwd(), "snapshots");
const SANITIZED_EMAIL = TARGET_EMAIL.replace(/[^a-zA-Z0-9_-]/g, "_");
const SNAPSHOT_FILE = process.env.SNAPSHOT_FILE || path.join(DEFAULT_SNAPSHOT_DIR, `snapshot_${SANITIZED_EMAIL}.json`);
const STATE_FILE = process.env.STATE_FILE || path.join(DEFAULT_SNAPSHOT_DIR, `state_${SANITIZED_EMAIL}.json`);

interface UserSnapshot {
  snapshotVersion: 1;
  capturedAt: string;
  targetEmail: string;
  uid: string;
  companyId: string;
  customClaims: Record<string, unknown>;
  firestoreDoc: Record<string, unknown>;
}

interface MigrationState {
  version: 1;
  targetEmail: string;
  uid: string;
  companyId: string;
  action: string;
  phase: "IDLE" | "SNAPSHOT_CAPTURED" | "CLAIMS_APPLIED" | "FIRESTORE_APPLIED" | "VERIFIED" | "FAILED_AND_ROLLED_BACK" | "ROLLED_BACK";
  lastUpdated: string;
  details?: Record<string, unknown>;
}

async function recordState(state: MigrationState) {
  try {
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), { encoding: "utf-8", mode: 0o600 });
  } catch (err) {
    console.warn("Could not write migration state file:", err instanceof Error ? err.message : String(err));
  }
}

async function main() {
  const isEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "d-arrow-buisiness";

  if (!isEmulator && !credentialPath) {
    console.error("Missing GOOGLE_APPLICATION_CREDENTIALS. Firebase Admin SDK authentication is not configured in this environment.");
    console.error("Manual setup: export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json and ensure the project has access to the target Firebase project.");
    process.exitCode = 1;
    return;
  }

  if (credentialPath) {
    const resolvedPath = path.resolve(credentialPath);
    try {
      await fs.access(resolvedPath);
    } catch {
      console.error(`Service account file not found: ${resolvedPath}`);
      process.exitCode = 1;
      return;
    }
  }

  const { initializeApp, getApps, applicationDefault } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");

  const appOptions: Record<string, unknown> = { projectId };
  if (credentialPath) {
    appOptions.credential = applicationDefault();
  }

  const app = getApps().length === 0 ? initializeApp(appOptions) : getApps()[0];

  const auth = getAuth(app);
  const db = getFirestore(app);

  const userRecord = await auth.getUserByEmail(TARGET_EMAIL);
  const userDocRef = db.collection("users").doc(userRecord.uid);
  const userSnap = await userDocRef.get();
  if (!userSnap.exists) {
    throw new Error(`No Firestore user profile found for uid ${userRecord.uid} (${TARGET_EMAIL})`);
  }

  const currentUser = userSnap.data() ?? {};
  const currentCompanyId = currentUser.companyId ?? "";

  // --------------------------------------------------------------------------
  // ACTION: ROLLBACK
  // --------------------------------------------------------------------------
  if (ACTION === "rollback") {
    let snapshotContent: string;
    try {
      snapshotContent = await fs.readFile(SNAPSHOT_FILE, "utf-8");
    } catch {
      console.error("=================================================================");
      console.error(" MANUAL RECOVERY INSTRUCTIONS (Snapshot File Missing):");
      console.error(` 1. Target Email: ${TARGET_EMAIL}, Target UID: ${userRecord.uid}`);
      console.error(` 2. Expected snapshot path: ${SNAPSHOT_FILE}`);
      console.error(" 3. Verify if snapshots directory was relocated or backed up.");
      console.error(" 4. Use Firebase Console / Admin SDK to restore original account state manually.");
      console.error("=================================================================");
      throw new Error(`Snapshot file not found for rollback: ${SNAPSHOT_FILE}. Cannot restore without authoritative pre-migration state.`);
    }

    let snapshot: UserSnapshot;
    try {
      snapshot = JSON.parse(snapshotContent) as UserSnapshot;
    } catch {
      console.error("=================================================================");
      console.error(" MANUAL RECOVERY INSTRUCTIONS (Snapshot Corrupted):");
      console.error(` 1. Snapshot file at ${SNAPSHOT_FILE} contains malformed JSON.`);
      console.error(" 2. Repair JSON syntax or restore file from storage backup.");
      console.error(` 3. Manually restore target user ${TARGET_EMAIL} (${userRecord.uid}) using Admin SDK.`);
      console.error("=================================================================");
      throw new Error(`Snapshot file is corrupt or invalid JSON: ${SNAPSHOT_FILE}`);
    }

    if (snapshot.snapshotVersion !== 1) {
      throw new Error(`Unsupported snapshot version: ${snapshot.snapshotVersion}`);
    }
    if (snapshot.targetEmail !== TARGET_EMAIL || snapshot.uid !== userRecord.uid) {
      console.error("=================================================================");
      console.error(" MANUAL RECOVERY INSTRUCTIONS (Identity Mismatch):");
      console.error(` 1. Current Target: ${TARGET_EMAIL} (${userRecord.uid})`);
      console.error(` 2. Snapshot Record: ${snapshot.targetEmail} (${snapshot.uid})`);
      console.error(" 3. Provide correct SNAPSHOT_FILE environment variable for this target user.");
      console.error("=================================================================");
      throw new Error(`Snapshot identity mismatch: file contains ${snapshot.targetEmail} (${snapshot.uid}), target is ${TARGET_EMAIL} (${userRecord.uid})`);
    }
    if (snapshot.companyId && snapshot.companyId !== currentCompanyId) {
      throw new Error(`Snapshot company mismatch: file has companyId ${snapshot.companyId}, target current is ${currentCompanyId}`);
    }

    if (process.env.DRY_RUN === "true") {
      console.log(JSON.stringify({
        mode: "DRY_RUN",
        action: "rollback",
        targetEmail: TARGET_EMAIL,
        uid: userRecord.uid,
        restoreSnapshotFile: SNAPSHOT_FILE,
        restoringClaims: snapshot.customClaims,
        restoringFirestoreDoc: snapshot.firestoreDoc,
      }, null, 2));
      return;
    }

    // Atomically restore claims and doc without merging
    await auth.setCustomUserClaims(userRecord.uid, snapshot.customClaims || null);
    await userDocRef.set({
      ...snapshot.firestoreDoc,
      restoredAt: new Date().toISOString(),
    }, { merge: false });

    // Verify consistency after rollback
    const verifiedUser = await auth.getUser(userRecord.uid);
    const verifiedDoc = (await userDocRef.get()).data() ?? {};
    if (verifiedDoc.role !== snapshot.firestoreDoc.role) {
      throw new Error(`Rollback consistency check failed: Firestore doc role is ${verifiedDoc.role}, expected ${snapshot.firestoreDoc.role}`);
    }

    await recordState({
      version: 1,
      targetEmail: TARGET_EMAIL,
      uid: userRecord.uid,
      companyId: currentCompanyId,
      action: "rollback",
      phase: "ROLLED_BACK",
      lastUpdated: new Date().toISOString(),
      details: {
        restoredRole: snapshot.firestoreDoc.role,
        restoredCountryScope: snapshot.firestoreDoc.countryScope,
      },
    });

    console.log(JSON.stringify({
      rolledBack: true,
      targetEmail: TARGET_EMAIL,
      uid: userRecord.uid,
      restoredFrom: SNAPSHOT_FILE,
      restoredRole: snapshot.firestoreDoc.role,
      restoredCountryScope: snapshot.firestoreDoc.countryScope,
    }, null, 2));
    return;
  }

  // --------------------------------------------------------------------------
  // ACTION: STATUS / INSPECT
  // --------------------------------------------------------------------------
  if (ACTION === "status") {
    console.log(JSON.stringify({
      targetEmail: TARGET_EMAIL,
      uid: userRecord.uid,
      companyId: currentCompanyId,
      currentRole: currentUser.role,
      currentCountryScope: currentUser.countryScope,
      customClaims: userRecord.customClaims ?? {},
      snapshotAvailable: await fs.access(SNAPSHOT_FILE).then(() => true).catch(() => false),
    }, null, 2));
    return;
  }

  // --------------------------------------------------------------------------
  // ACTION: ACTIVATE (Default)
  // --------------------------------------------------------------------------
  const existingCountryScope = Array.isArray(currentUser.countryScope) ? currentUser.countryScope : [];

  if (!currentCompanyId) {
    throw new Error(`User ${TARGET_EMAIL} is missing companyId; refusing to assign a tenant-scoped role.`);
  }

  const companyRef = db.collection("companies").doc(currentCompanyId);
  const companySnap = await companyRef.get();
  if (!companySnap.exists) {
    throw new Error(`Company ${currentCompanyId} does not exist; refusing to update role assignment.`);
  }

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

  const existingPortalAccess = Array.isArray(currentUser.portalAccess) ? currentUser.portalAccess : [];
  const portalAccess = Array.from(new Set([...existingPortalAccess, "people"]));

  const updatePayload = {
    ...currentUser,
    role: TARGET_ROLE,
    companyId: currentCompanyId,
    countryScope,
    portalAccess,
    portalSubRoles: {
      ...(typeof currentUser.portalSubRoles === "object" && currentUser.portalSubRoles ? currentUser.portalSubRoles : {}),
      people: "admin",
    },
    updatedAt: new Date().toISOString(),
  };

  // 1. Prepare Snapshot
  const snapshotData: UserSnapshot = {
    snapshotVersion: 1,
    capturedAt: new Date().toISOString(),
    targetEmail: TARGET_EMAIL,
    uid: userRecord.uid,
    companyId: currentCompanyId,
    customClaims: userRecord.customClaims ?? {},
    firestoreDoc: currentUser,
  };

  if (process.env.DRY_RUN === "true") {
    console.log(JSON.stringify({
      mode: "DRY_RUN",
      action: "activate",
      targetEmail: TARGET_EMAIL,
      uid: userRecord.uid,
      companyId: currentCompanyId,
      customClaims,
      firestoreUpdate: updatePayload,
      snapshotPlannedFile: SNAPSHOT_FILE,
      branchCountries: Array.from(branchCountryCodes),
    }, null, 2));
    return;
  }

  // Persist snapshot to disk before modifying Auth or Firestore (preserve original baseline if snapshot exists)
  await fs.mkdir(path.dirname(SNAPSHOT_FILE), { recursive: true });
  const snapshotExists = await fs.access(SNAPSHOT_FILE).then(() => true).catch(() => false);
  if (!snapshotExists || process.env.OVERWRITE_SNAPSHOT === "true") {
    await fs.writeFile(SNAPSHOT_FILE, JSON.stringify(snapshotData, null, 2), { encoding: "utf-8", mode: 0o600 });
  }

  await recordState({
    version: 1,
    targetEmail: TARGET_EMAIL,
    uid: userRecord.uid,
    companyId: currentCompanyId,
    action: "activate",
    phase: "SNAPSHOT_CAPTURED",
    lastUpdated: new Date().toISOString(),
  });

  try {
    // Phase 2: Apply custom claims
    await auth.setCustomUserClaims(userRecord.uid, customClaims);
    await recordState({
      version: 1,
      targetEmail: TARGET_EMAIL,
      uid: userRecord.uid,
      companyId: currentCompanyId,
      action: "activate",
      phase: "CLAIMS_APPLIED",
      lastUpdated: new Date().toISOString(),
    });

    // Phase 3: Apply Firestore document update
    await userDocRef.set(updatePayload, { merge: true });
    await recordState({
      version: 1,
      targetEmail: TARGET_EMAIL,
      uid: userRecord.uid,
      companyId: currentCompanyId,
      action: "activate",
      phase: "FIRESTORE_APPLIED",
      lastUpdated: new Date().toISOString(),
    });

    // Phase 4: Consistency Verification
    const verifiedUser = await auth.getUser(userRecord.uid);
    const verifiedClaims = (verifiedUser.customClaims ?? {}) as Record<string, unknown>;
    const verifiedDoc = (await userDocRef.get()).data() ?? {};

    const claimsMatch = verifiedClaims.role === TARGET_ROLE
      && verifiedClaims.companyId === currentCompanyId
      && Array.isArray(verifiedClaims.countryScope)
      && countryScope.every((c) => (verifiedClaims.countryScope as string[]).includes(c));

    const docMatches = verifiedDoc.role === TARGET_ROLE
      && verifiedDoc.companyId === currentCompanyId
      && Array.isArray(verifiedDoc.countryScope)
      && countryScope.every((c) => (verifiedDoc.countryScope as string[]).includes(c))
      && verifiedDoc.portalSubRoles?.people === "admin";

    if (!claimsMatch || !docMatches) {
      throw new Error(`Consistency verification failed: Claims match = ${claimsMatch}, Doc matches = ${docMatches}`);
    }

    await recordState({
      version: 1,
      targetEmail: TARGET_EMAIL,
      uid: userRecord.uid,
      companyId: currentCompanyId,
      action: "activate",
      phase: "VERIFIED",
      lastUpdated: new Date().toISOString(),
      details: {
        role: TARGET_ROLE,
        countryScope,
        companyId: currentCompanyId,
      },
    });

    console.log(JSON.stringify({
      updated: true,
      targetEmail: TARGET_EMAIL,
      uid: userRecord.uid,
      companyId: currentCompanyId,
      role: TARGET_ROLE,
      countryScope,
      snapshotSavedTo: SNAPSHOT_FILE,
      stateFile: STATE_FILE,
      consistencyVerified: true,
    }, null, 2));
  } catch (error) {
    console.error("Migration error occurred! Initiating automatic recovery rollback...", error instanceof Error ? error.message : String(error));
    try {
      await auth.setCustomUserClaims(userRecord.uid, snapshotData.customClaims || null);
      await userDocRef.set({
        ...snapshotData.firestoreDoc,
        recoveredAt: new Date().toISOString(),
      }, { merge: false });

      await recordState({
        version: 1,
        targetEmail: TARGET_EMAIL,
        uid: userRecord.uid,
        companyId: currentCompanyId,
        action: "activate",
        phase: "FAILED_AND_ROLLED_BACK",
        lastUpdated: new Date().toISOString(),
        details: {
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      console.log("Automatic recovery rollback successfully restored baseline snapshot.");
    } catch (recoveryErr) {
      console.error("CRITICAL: Automatic rollback failed after migration error:", recoveryErr);
      console.error("=================================================================");
      console.error(" MANUAL RECOVERY INSTRUCTIONS (Auto-Rollback Failure):");
      console.error(` 1. Target UID: ${userRecord.uid}, Target Email: ${TARGET_EMAIL}`);
      console.error(` 2. Snapshot file path: ${SNAPSHOT_FILE}`);
      console.error(` 3. Authoritative pre-migration role: ${snapshotData.firestoreDoc.role || 'employee'}`);
      console.error(` 4. Reset custom claims: firebase auth:claims ${userRecord.uid} or use Admin SDK`);
      console.error(` 5. Reset Firestore doc: collection('users').doc('${userRecord.uid}')`);
      console.error("=================================================================");
    }
    throw error;
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Activation failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

