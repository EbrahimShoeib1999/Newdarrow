import {
  EXPECTED_ATOM_COUNT,
  EXPECTED_GRANT_COUNT,
  INVITABLE_ROLES,
  MANIFEST_CHECKSUM,
  PERMISSION_ATOMS,
  ROLE_GRANTS,
  ROLE_ORDER,
  manifestChecksum,
} from "./manifest";

/**
 * T2.2 — fidelity of the backend port of the frontend permission manifest.
 * The expected figures below are the session-verified counts from the frontend
 * source (src/lib/permissions/index.ts), counted at runtime on 2026-11-11;
 * they are duplicated here (not imported from manifest.ts constants alone) so a
 * hand-edit of the manifest arrays cannot silently pass.
 */
describe("permission manifest port (T2.2)", () => {
  it("carries exactly the 70 verified atoms, all unique", () => {
    expect(PERMISSION_ATOMS).toHaveLength(70);
    expect(PERMISSION_ATOMS).toHaveLength(EXPECTED_ATOM_COUNT);
    expect(new Set(PERMISSION_ATOMS).size).toBe(70);
  });

  it("matches the verified per-role grant counts (320 grants total)", () => {
    const expectedCounts: Record<string, number> = {
      platform_admin: 70,
      super_admin: 70,
      admin: 69,
      manager: 60,
      global_hr_manager: 17,
      employee: 29,
      viewer: 5,
    };
    let total = 0;
    for (const role of ROLE_ORDER) {
      expect(ROLE_GRANTS[role]).toHaveLength(expectedCounts[role]);
      total += ROLE_GRANTS[role].length;
    }
    expect(total).toBe(320);
    expect(total).toBe(EXPECTED_GRANT_COUNT);
  });

  it("grants only atoms from the vocabulary", () => {
    const vocabulary = new Set<string>(PERMISSION_ATOMS);
    for (const role of ROLE_ORDER) {
      for (const atom of ROLE_GRANTS[role]) {
        expect(vocabulary.has(atom)).toBe(true);
      }
    }
  });

  it("admin has every atom except company.identity (verified business rule)", () => {
    const expected = PERMISSION_ATOMS.filter((atom) => atom !== "company.identity");
    expect([...ROLE_GRANTS.admin].sort()).toEqual([...expected].sort());
  });

  it("records the invitable roles (invite role policy, commit 6b38c3b)", () => {
    expect([...INVITABLE_ROLES].sort()).toEqual([
      "employee",
      "global_hr_manager",
      "manager",
      "viewer",
    ]);
  });

  it("exposes a deterministic checksum matching the recorded port checksum", () => {
    expect(MANIFEST_CHECKSUM).toMatch(/^[0-9a-f]{64}$/);
    expect(manifestChecksum()).toBe(MANIFEST_CHECKSUM);
    expect(manifestChecksum()).toBe(manifestChecksum());
  });
});
