/**
 * Matrix probe: which sub-expression crashes the emulator's LIST-gate
 * evaluation for array-contains queries on conversations?
 * Each variant gets its own emulator project so all run in ONE boot.
 */
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, collection, getDocs, query, where } from "firebase/firestore";

const COMPANY = "acme-co";
const EMP_UID = "emp-uid-1";

const HELPERS = `
  function signedIn() { return request.auth != null; }
  function hasUserDoc() { return signedIn() && exists(/databases/$(database)/documents/users/$(request.auth.uid)); }
  function userDoc() { return get(/databases/$(database)/documents/users/$(request.auth.uid)).data; }
  function belongsToCompany(companyId) { return signedIn() && hasUserDoc() && userDoc().companyId == companyId; }
  function isCompanyAdmin(companyId) { return belongsToCompany(companyId) && userDoc().role in ['super_admin', 'admin']; }
  function customPermissions() { return userDoc().get('customPermissions', []) is list ? userDoc().get('customPermissions', []) : []; }
`;

function rulesWith(readExpr) {
  return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    ${HELPERS}
    match /users/{userId} { allow read, write: if true; }
    match /companies/{companyId} {
      allow read, write: if belongsToCompany(companyId);
      match /conversations/{cid} { allow read: if ${readExpr}; }
    }
  }
}`;
}

const allVariants = {
  A_unconditional: `belongsToCompany(companyId)`,
  B_typeGet: `belongsToCompany(companyId) && resource.data.get('type', '') == 'public'`,
  C_memberIdsGet: `belongsToCompany(companyId) && resource.data.get('memberIds', []) is list`,
  D_typeIn: `belongsToCompany(companyId) && 'type' in resource.data`,
  E_typeOrAdmin: `belongsToCompany(companyId) && (resource.data.get('type', '') == 'public' || isCompanyAdmin(companyId))`,
  F_memberOrAdmin: `belongsToCompany(companyId) && (resource.data.get('memberIds', []) is list && request.auth.uid in resource.data.get('memberIds', []) || isCompanyAdmin(companyId))`,
  G_thirdRead: `belongsToCompany(companyId) && userDoc().role == 'employee'`,
  H_orFalse: `belongsToCompany(companyId) && (resource.data.get('type', '') == 'public' || false)`,
  I_orAdminNoResource: `belongsToCompany(companyId) && (false || isCompanyAdmin(companyId))`,
  J_adminAlone: `isCompanyAdmin(companyId)`,
  K_orDoubleBelongs: `belongsToCompany(companyId) && (resource.data.get('type', '') == 'public' || belongsToCompany(companyId))`,
  L_orExists: `belongsToCompany(companyId) && (resource.data.get('type', '') == 'public' || hasUserDoc())`,
  // Same access shape as G (inline ==, OK) but with list-membership `in`.
  // If this CRASHes, the emulator's LIST-gate bug is the `in` operator.
  M_inlineIn: `belongsToCompany(companyId) && userDoc().role in ['super_admin', 'admin']`,
  // `in` against a static list of literals without any document access.
  N_inNoAccess: `request.auth.uid in ['nobody', 'also-not-me']`,
  // Candidate replacement idioms for doc-valued list membership (must deny
  // CLEANLY on the LIST gate to be shippable):
  O_hasAny: `belongsToCompany(companyId) && customPermissions().hasAny(['people.view_all_reports'])`,
  P_roleEqOr: `belongsToCompany(companyId) && (userDoc().role == 'super_admin' || userDoc().role == 'admin')`,
  Q_getHasAny: `belongsToCompany(companyId) && userDoc().get('portalSubRoles', {}).keys().hasAny(['zzz'])`,
};

// One variant per emulator boot (the emulator only accepts rule uploads for
// its --project). Select with VARIANT=<key>.
const key = process.env.VARIANT;
const expr = allVariants[key];
if (!expr) {
  console.error(`unknown variant ${key}`);
  process.exit(2);
}

const env = await initializeTestEnvironment({
  projectId: "matrix-run",
  firestore: { rules: rulesWith(expr) },
});
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), "users", EMP_UID), { companyId: COMPANY, role: "employee", customPermissions: [], portalSubRoles: {} });
});
const db = env.authenticatedContext(EMP_UID).firestore();
const col = collection(db, "companies", COMPANY, "conversations");
let outcome;
try {
  await getDocs(query(col, where("memberIds", "array-contains", EMP_UID)));
  outcome = "OK (empty list resolved)";
} catch (err) {
  const msg = (err?.message || "").replace(/\s+/g, " ").slice(0, 200);
  outcome = /Property .* is undefined/i.test(msg)
    ? `CRASH: ${msg}`
    : `DENIED: ${msg}`;
}
console.log(`${key.padEnd(16)} => ${outcome}`);
process.exit(0);
