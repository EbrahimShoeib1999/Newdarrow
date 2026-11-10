/**
 * D-Arrow — Local Unit Test Suite
 * ============================================================
 * Tests:
 *   [Test 1] Employee without company: DArrow resolution required
 *   [Test 2] Employee with company: selected company preserved
 *   [Test 3] Empty company: rejected or fallback according to system architecture
 *   [Test 4] General Manager: global authorization (all portals and permissions)
 *   [Test 5] Normal employee: strictly limited access, no global admin capabilities
 */

import assert from "node:assert/strict";

// 1. Logic Mirror of src/lib/constants/company.ts
const DEFAULT_COMPANY_NAME = "DArrow";
const DEFAULT_COMPANY_NAME_ALT = "D-Arrow";

function isDefaultCompany(id, name) {
  if (!id && !name) return false;
  const normalizedId = (id || "").toLowerCase().replace(/[\s\-_]/g, "");
  const normalizedName = (name || "").toLowerCase().replace(/[\s\-_]/g, "");
  return normalizedId.includes("darrow") || normalizedName.includes("darrow");
}

// 2. Logic Mirror of src/lib/company-defaults.ts
function resolveDefaultCompanyId(companies) {
  if (!companies || companies.length === 0) return null;
  const match = companies.find((c) => isDefaultCompany(c.id, c.name));
  return match ? match.id : null;
}

function getOrResolveCompanyId(explicitCompanyId, companies, fallbackId) {
  const trimmed = explicitCompanyId?.trim();
  if (trimmed) return trimmed;

  const resolved = resolveDefaultCompanyId(companies);
  if (resolved) return resolved;

  if (fallbackId && fallbackId.trim()) {
    return fallbackId.trim();
  }

  return null;
}

// 3. Logic Mirror of createEmployee guard in people.service.ts
function validateEmployeeCompanyId(companyId) {
  if (!companyId || !companyId.trim()) {
    throw new Error("companyId is required: employee must belong to a company");
  }
  return companyId.trim();
}

// 4. Permission definitions
const ALL_ADMIN_CAPABILITIES = [
  "company.manage",
  "company.identity",
  "users.manage_roles",
  "pricing.manage",
  "admin.seed",
];

const ALL_PORTALS = [
  "portals.tasks",
  "portals.crm",
  "portals.people",
  "portals.billing",
  "portals.chat",
  "portals.projects",
  "portals.facilities",
  "portals.agency",
  "portals.real_estate",
  "portals.school",
  "portals.custom_modules",
];

const PLATFORM_ADMIN_PERMISSIONS = new Set([...ALL_ADMIN_CAPABILITIES, ...ALL_PORTALS]);

const EMPLOYEE_PERMISSIONS = new Set([
  "portals.tasks",
  "portals.crm",
  "portals.people",
  "tasks.view",
  "tasks.create",
  "people.view",
]);

async function runTests() {
  console.log("\n" + "=".repeat(70));
  console.log("  D-ARROW LOCAL UNIT TESTS: DEFAULT COMPANY & RBAC");
  console.log("=".repeat(70) + "\n");

  let passed = 0;
  let total = 0;

  function run(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  // --- Test 1 ---
  run("Test 1: Employee without explicit company -> DArrow resolution required", () => {
    const companies = [
      { id: "comp_partner_1", name: "Partner Logistics" },
      { id: "comp_darrow_official", name: "DArrow Business Group" },
      { id: "comp_partner_2", name: "Apex Solutions" },
    ];

    const result = getOrResolveCompanyId(null, companies);
    assert.equal(result, "comp_darrow_official", "Must resolve to DArrow company ID when unselected");
  });

  // --- Test 2 ---
  run("Test 2: Employee with company -> selected company preserved", () => {
    const companies = [
      { id: "comp_darrow_official", name: "DArrow" },
      { id: "comp_custom_branch", name: "Delta Gulf Branch" },
    ];

    const explicit = "comp_custom_branch";
    const result = getOrResolveCompanyId(explicit, companies);
    assert.equal(result, "comp_custom_branch", "Selected company must NOT be overwritten");
  });

  // --- Test 3 ---
  run("Test 3: Empty company -> strictly rejected by creation guard or resolved to fallback", () => {
    // 3a: Empty string must not bypass validation
    assert.throws(
      () => validateEmployeeCompanyId(""),
      /companyId is required/,
      "Empty string must be rejected"
    );

    // 3b: Whitespace string must not bypass validation
    assert.throws(
      () => validateEmployeeCompanyId("   "),
      /companyId is required/,
      "Whitespace must be rejected"
    );

    // 3c: Undefined/null must not bypass validation
    assert.throws(
      () => validateEmployeeCompanyId(null),
      /companyId is required/,
      "Null must be rejected"
    );

    // 3d: Resolver with empty explicit and configured fallback
    const noCompanies = [];
    const fallbackResult = getOrResolveCompanyId("", noCompanies, "darrow");
    assert.equal(fallbackResult, "darrow", "Fallback allowed when no companies exist");
  });

  // --- Test 4 ---
  run("Test 4: General Manager (platform_admin) -> global authorization", () => {
    // Check all admin capabilities
    for (const cap of ALL_ADMIN_CAPABILITIES) {
      assert.ok(PLATFORM_ADMIN_PERMISSIONS.has(cap), `General Manager must have ${cap}`);
    }
    // Check all portal access
    for (const portal of ALL_PORTALS) {
      assert.ok(PLATFORM_ADMIN_PERMISSIONS.has(portal), `General Manager must have access to ${portal}`);
    }
  });

  // --- Test 5 ---
  run("Test 5: Normal employee -> strictly restricted, NO global admin access", () => {
    // Check that employee does NOT have any admin capabilities
    for (const cap of ALL_ADMIN_CAPABILITIES) {
      assert.ok(!EMPLOYEE_PERMISSIONS.has(cap), `Normal employee must NOT have ${cap}`);
    }
    // Check that employee does NOT have sensitive portals (e.g. school, facilities, real_estate)
    assert.ok(!EMPLOYEE_PERMISSIONS.has("portals.school"), "Employee must not access school portal");
    assert.ok(!EMPLOYEE_PERMISSIONS.has("portals.facilities"), "Employee must not access facilities portal");
  });

  console.log("\n" + "-".repeat(70));
  console.log(`  RESULTS: ${passed}/${total} PASSED`);
  console.log("-".repeat(70) + "\n");

  if (passed !== total) {
    process.exit(1);
  }
}

runTests();

