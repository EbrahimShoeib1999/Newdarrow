import { retryAuthProfile } from "../src/features/auth/utils/retry-auth-profile";
import { mapFirestoreUser } from "../src/features/auth/utils/map-user";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  let reads = 0;
  let waits = 0;
  let provisioningComplete = false;
  const profile = await retryAuthProfile(
    async () => {
      reads += 1;
      if (reads === 1) return undefined;
      return {
        companyId: "created-company",
        companyExists: provisioningComplete,
      };
    },
    (candidate) =>
      !!candidate &&
      candidate.companyId !== "default-company" &&
      candidate.companyExists,
    async () => {
      waits += 1;
      if (waits === 2) provisioningComplete = true;
    }
  );

  assert(profile?.companyId === "created-company", "race did not resolve actual tenant");
  assert(profile.companyId !== "", "resolved companyId is empty");
  assert(profile.companyId !== "default-company", "resolved fabricated tenant");
  assert(reads === 3, `expected the delayed company to resolve on the third read, got ${reads}`);

  reads = 0;
  const incomplete = await retryAuthProfile(
    async () => {
      reads += 1;
      return { companyId: "default-company", companyExists: false };
    },
    (candidate) =>
      !!candidate &&
      candidate.companyId !== "default-company" &&
      candidate.companyExists,
    async () => undefined
  );
  assert(reads === 4, `retry was not bounded to 4 reads, got ${reads}`);
  assert(
    incomplete?.companyId === "default-company",
    "retry should return observed state for caller to surface as provisioning error"
  );

  const missingProfile = mapFirestoreUser("user-uid", undefined);
  const fakeTenantProfile = mapFirestoreUser("user-uid", {
    companyId: "default-company",
  });
  const paddedFakeTenantProfile = mapFirestoreUser("user-uid", {
    companyId: " default-company ",
  });
  const claimedOnlyTenant = mapFirestoreUser(
    "user-uid",
    undefined,
    {},
    { companyId: "claimed-company" }
  );
  assert(missingProfile.companyId === "", "missing profile assigned a tenant");
  assert(fakeTenantProfile.companyId === "", "default-company was accepted as tenant");
  assert(
    paddedFakeTenantProfile.companyId === "",
    "whitespace-wrapped default-company was accepted as tenant"
  );
  assert(claimedOnlyTenant.companyId === "", "missing profile used a claim-only tenant");
  console.log("PASS: delayed user/company provisioning resolves the actual tenant");
  console.log("PASS: incomplete/default tenant state retries a bounded number of times");
  console.log("PASS: user mapping never promotes a missing/default tenant");
}

void main();
