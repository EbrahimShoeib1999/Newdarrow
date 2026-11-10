import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { promises as fs } from "node:fs";
import path from "node:path";

const TARGET_EMAIL = process.env.DARROW_TARGET_EMAIL || "khulodahmed390@gmail.com";
const TARGET_ROLE = "platform_admin";
const TARGET_COUNTRY_SCOPE = ["EG", "SA"];
// If set, overrides the companyId found in Firestore (used when Khuloud's doc
// has an empty companyId but we know the correct DArrow company ID).
const OVERRIDE_COMPANY_ID = process.env.DARROW_COMPANY_ID || "";
const ALL_PORTAL_IDS = [
  "dashboard",
  "crm",
  "tasks",
  "people",
  "financial",
  "inventory",
  "operations",
  "strategy",
  "support",
  "pos",
  "rem",
];

const ACTION = process.env.ACTION || "activate"; // "activate" | "rollback" | "status"
const DEFAULT_SNAPSHOT_DIR = path.resolve(process.cwd(), "snapshots");
const SANITIZED_EMAIL = TARGET_EMAIL.replace(/[^a-zA-Z0-9_-]/g, "_");
const SNAPSHOT_FILE = process.env.SNAPSHOT_FILE || path.join(DEFAULT_SNAPSHOT_DIR, `snapshot_${SANITIZED_EMAIL}_platform_admin.json`);
const STATE_FILE = process.env.STATE_FILE || path.join(DEFAULT_SNAPSHOT_DIR, `state_${SANITIZED_EMAIL}_platform_admin.json`);

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
  // Resolve effective companyId: prefer OVERRIDE > Firestore doc > ""
  const effectiveCompanyId = OVERRIDE_COMPANY_ID || currentCompanyId;

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
        restoredPortalAccess: snapshot.firestoreDoc.portalAccess,
      },
    });

    console.log(JSON.stringify({
      rolledBack: true,
      targetEmail: TARGET_EMAIL,
      uid: userRecord.uid,
      restoredFrom: SNAPSHOT_FILE,
      restoredRole: snapshot.firestoreDoc.role,
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
      currentPortalAccess: currentUser.portalAccess,
      currentPortalSubRoles: currentUser.portalSubRoles,
      customClaims: userRecord.customClaims ?? {},
      snapshotAvailable: await fs.access(SNAPSHOT_FILE).then(() => true).catch(() => false),
    }, null, 2));
    return;
  }

  // --------------------------------------------------------------------------
  // ACTION: ACTIVATE (Default)
  // --------------------------------------------------------------------------
  const existingCountryScope = Array.isArray(currentUser.countryScope) ? currentUser.countryScope : [];
  const countryScope = Array.from(new Set([...TARGET_COUNTRY_SCOPE, ...existingCountryScope]));

  const customClaims = {
    ...(userRecord.customClaims ?? {}),
    role: TARGET_ROLE,
    companyId: effectiveCompanyId,
  };

  const portalAccess = ALL_PORTAL_IDS;

  const updatePayload = {
    ...currentUser,
    role: TARGET_ROLE,
    companyId: effectiveCompanyId,
    countryScope,
    portalAccess,
    portalSubRoles: {
      tasks: "admin",
      crm: "admin",
      people: "admin",
      billing: "admin",
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
      companyIdFromFirestore: currentCompanyId,
      effectiveCompanyId,
      customClaims,
      firestoreUpdate: updatePayload,
      snapshotPlannedFile: SNAPSHOT_FILE,
    }, null, 2));
    return;
  }

  // Persist snapshot to disk before modifying Auth or Firestore
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

    const claimsMatch = verifiedClaims.role === TARGET_ROLE;
    const docMatches = verifiedDoc.role === TARGET_ROLE
      && Array.isArray(verifiedDoc.portalAccess)
      && verifiedDoc.portalSubRoles?.billing === "admin";

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
        portalAccessCount: portalAccess.length,
      },
    });

    console.log(JSON.stringify({
      activated: true,
      targetEmail: TARGET_EMAIL,
      uid: userRecord.uid,
      assignedRole: TARGET_ROLE,
      portalAccessCount: portalAccess.length,
      snapshotSavedTo: SNAPSHOT_FILE,
      stateFile: STATE_FILE,
    }, null, 2));
  } catch (activationErr) {
    console.error("ACTIVATION FAILED. INITIATING AUTOMATIC ROLLBACK TO PRESERVE INTEGRITY...", activationErr);

    try {
      await auth.setCustomUserClaims(userRecord.uid, snapshotData.customClaims || null);
      await userDocRef.set(snapshotData.firestoreDoc, { merge: false });

      await recordState({
        version: 1,
        targetEmail: TARGET_EMAIL,
        uid: userRecord.uid,
        companyId: currentCompanyId,
        action: "activate",
        phase: "FAILED_AND_ROLLED_BACK",
        lastUpdated: new Date().toISOString(),
        details: {
          error: activationErr instanceof Error ? activationErr.message : String(activationErr),
        },
      });

      console.error("AUTOMATIC ROLLBACK COMPLETED SUCCESSFULLY.");
    } catch (rollbackErr) {
      console.error("CRITICAL: AUTOMATIC ROLLBACK FAILED. MANUAL RECOVERY REQUIRED.");
      console.error("=================================================================");
      console.error(" MANUAL RECOVERY INSTRUCTIONS:");
      console.error(` 1. Target Email: ${TARGET_EMAIL}, UID: ${userRecord.uid}`);
      console.error(` 2. Snapshot Location: ${SNAPSHOT_FILE}`);
      console.error(" 3. Run: npm run rollback:platform-admin");
      console.error(" 4. If script fails, inspect snapshot JSON and apply fields via Admin SDK.");
      console.error("=================================================================");
      throw rollbackErr;
    }

    throw activationErr;
  }
}

main().catch((err) => {
  console.error("Error executing activate-platform-admin script:", err);
  process.exitCode = 1;
});

