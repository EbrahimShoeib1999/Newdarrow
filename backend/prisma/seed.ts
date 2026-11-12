/**
 * T2.2 seed — syncs DB-backed RBAC from the code-defined manifest (decision D8).
 *
 * The Permission and RolePermission tables are DERIVED data: this seed rebuilds them
 * wholesale inside one transaction from src/permissions/manifest.ts (the verbatim
 * port of the frontend manifest). Idempotent and drift-correcting — re-running after
 * a manifest re-port replaces the tables' contents exactly. The manifest checksum and
 * counts are asserted first (a drifted hand-edit is refused), and PermissionSyncState
 * records what was synced so a startup check (Phase 3) can detect DB/code drift.
 *
 * Run: npm run db:seed (after db:migrate). The database URL comes from the shared env
 * contract in src/config/env.ts (backend/.env, with real environment variables winning),
 * because @prisma/client does not load .env files itself — only the Prisma CLI does.
 */
import { PrismaClient, RoleSlug } from "@prisma/client";
import { loadEnv } from "../src/config/env";
import {
  EXPECTED_ATOM_COUNT,
  EXPECTED_GRANT_COUNT,
  MANIFEST_CHECKSUM,
  PERMISSION_ATOMS,
  ROLE_GRANTS,
  ROLE_ORDER,
  manifestChecksum,
} from "../src/permissions/manifest";

// The client reads env("DATABASE_URL") at query time and does NOT load .env itself
// (verified against @prisma/client 6.19.3: unset DATABASE_URL fails with
// "Environment variable not found"). Passing the validated URL explicitly keeps
// src/config/env.ts the single environment gateway. Real environment variables win
// over backend/.env, so `DATABASE_URL=<other-url> npm run db:seed` targets another
// database deliberately (e.g. darrow_test).
const env = loadEnv();

if (!env.DATABASE_URL) {
  console.error(
    "[seed] DATABASE_URL is not set. Copy backend/.env.example to backend/.env (gitignored) " +
      "and configure it — see README section 'Local database'.",
  );
  process.exit(1);
}

const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });

/** Frontend role keys (snake_case, verbatim port) → Prisma RoleSlug enum values. */
const ROLE_SLUG_BY_KEY: Record<(typeof ROLE_ORDER)[number], RoleSlug> = {
  platform_admin: "PLATFORM_ADMIN",
  super_admin: "SUPER_ADMIN",
  admin: "ADMIN",
  manager: "MANAGER",
  global_hr_manager: "GLOBAL_HR_MANAGER",
  employee: "EMPLOYEE",
  viewer: "VIEWER",
};

function assertManifestFidelity(): void {
  const totalGrants = ROLE_ORDER.reduce((sum, role) => sum + ROLE_GRANTS[role].length, 0);
  if (PERMISSION_ATOMS.length !== EXPECTED_ATOM_COUNT) {
    throw new Error(`manifest drift: ${PERMISSION_ATOMS.length} atoms, expected ${EXPECTED_ATOM_COUNT}`);
  }
  if (totalGrants !== EXPECTED_GRANT_COUNT) {
    throw new Error(`manifest drift: ${totalGrants} grants, expected ${EXPECTED_GRANT_COUNT}`);
  }
  const checksum = manifestChecksum();
  if (checksum !== MANIFEST_CHECKSUM) {
    throw new Error(`manifest drift: checksum ${checksum} does not match recorded ${MANIFEST_CHECKSUM}`);
  }
}

async function main(): Promise<void> {
  assertManifestFidelity();

  const grantRows = ROLE_ORDER.flatMap((role) => {
    const roleSlug = ROLE_SLUG_BY_KEY[role];
    return ROLE_GRANTS[role].map((atom) => ({ role: roleSlug, atom }));
  });

  const checksum = manifestChecksum();
  const atomCount = PERMISSION_ATOMS.length;
  const grantCount = grantRows.length;

  await prisma.$transaction(async (tx) => {
    // Derived tables — rebuild wholesale (no user data lives here).
    await tx.rolePermission.deleteMany({});
    await tx.permission.deleteMany({});
    await tx.permission.createMany({ data: PERMISSION_ATOMS.map((atom) => ({ atom })) });
    await tx.rolePermission.createMany({ data: grantRows });
    await tx.permissionSyncState.upsert({
      where: { id: "current" },
      update: { manifestChecksum: checksum, atomCount, grantCount, syncedAt: new Date() },
      create: { id: "current", manifestChecksum: checksum, atomCount, grantCount, syncedAt: new Date() },
    });
  });

  console.log(
    `[seed] RBAC synced: ${atomCount} atoms, ${grantCount} grants (checksum ${checksum.slice(0, 12)}…)`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error("[seed] failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
