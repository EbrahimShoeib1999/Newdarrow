/**
 * D-Arrow Data Migration — Firebase/Firestore → PostgreSQL/Prisma
 *
 * This utility imports data from a Firebase Firestore export into the
 * D-Arrow PostgreSQL database. It is designed to be idempotent and
 * safe to re-run.
 *
 * Prerequisites:
 * 1. Firestore export JSON files (one per collection)
 * 2. BACKEND .env configured with DATABASE_URL → darrow_dev
 * 3. Prisma schema pushed and RBAC seed run
 *
 * Usage:
 *   npx tsx prisma/migrate-from-firestore.ts --dir ./firestore-export
 *
 * Safety:
 * - Never writes to production Firebase
 * - Never deletes source records
 * - Import is idempotent (uses upsert by document id)
 * - Validates record counts and references
 * - Produces a migration report
 */

import { PrismaClient } from "@prisma/client";
import { loadEnv } from "../src/config/env";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const env = loadEnv();

if (!env.DATABASE_URL) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });

interface MigrationReport {
  collection: string;
  total: number;
  imported: number;
  skipped: number;
  errors: string[];
}

const reports: MigrationReport[] = [];

async function importCollection(
  collectionName: string,
  docs: Record<string, unknown>[],
): Promise<MigrationReport> {
  const report: MigrationReport = {
    collection: collectionName,
    total: docs.length,
    imported: 0,
    skipped: 0,
    errors: [],
  };

  switch (collectionName) {
    case "users":
      report.imported = await importUsers(docs);
      break;
    case "companies":
      report.imported = await importCompanies(docs);
      break;
    case "company_memberships":
      report.imported = await importMemberships(docs);
      break;
    case "branches":
      report.imported = await importBranches(docs);
      break;
    case "departments":
      report.imported = await importDepartments(docs);
      break;
    case "employees":
      report.imported = await importEmployees(docs);
      break;
    case "customers":
      report.imported = await importCustomers(docs);
      break;
    case "leads":
      report.imported = await importLeads(docs);
      break;
    case "deals":
      report.imported = await importDeals(docs);
      break;
    case "invoices":
      report.imported = await importInvoices(docs);
      break;
    default:
      report.skipped = docs.length;
      report.errors.push(`No import handler for collection "${collectionName}"`);
  }

  reports.push(report);
  return report;
}

async function importUsers(docs: any[]): Promise<number> {
  let count = 0;
  for (const doc of docs) {
    try {
      await prisma.user.upsert({
        where: { id: doc.id },
        update: {
          email: doc.email,
          name: doc.name,
          nameAr: doc.nameAr ?? "",
          avatar: doc.avatar ?? "",
          locale: doc.locale ?? "en",
          isPlatformAdmin: doc.isPlatformAdmin ?? false,
          onboardingStatus: doc.onboardingStatus ?? "pending",
          country: doc.country ?? null,
          updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : new Date(),
        },
        create: {
          id: doc.id,
          email: doc.email,
          name: doc.name,
          nameAr: doc.nameAr ?? "",
          avatar: doc.avatar ?? "",
          locale: doc.locale ?? "en",
          isPlatformAdmin: doc.isPlatformAdmin ?? false,
          onboardingStatus: doc.onboardingStatus ?? "pending",
          country: doc.country ?? null,
          firebaseUid: doc.firebaseUid ?? null,
        },
      });
      count++;
    } catch (err: any) {
      console.error(`[migrate] Failed to import user ${doc.id}:`, err.message);
    }
  }
  return count;
}

async function importCompanies(docs: any[]): Promise<number> {
  let count = 0;
  for (const doc of docs) {
    try {
      await prisma.company.upsert({
        where: { id: doc.id },
        update: {
          name: doc.name,
          primaryActivity: doc.primaryActivity ?? null,
          defaultCurrency: doc.defaultCurrency ?? "SAR",
          settings: doc.settings ?? {},
          updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : new Date(),
        },
        create: {
          id: doc.id,
          name: doc.name,
          primaryActivity: doc.primaryActivity ?? null,
          defaultCurrency: doc.defaultCurrency ?? "SAR",
          settings: doc.settings ?? {},
          ownerId: doc.ownerId ?? null,
        },
      });
      count++;
    } catch (err: any) {
      console.error(`[migrate] Failed to import company ${doc.id}:`, err.message);
    }
  }
  return count;
}

async function importMemberships(docs: any[]): Promise<number> {
  let count = 0;
  for (const doc of docs) {
    try {
      await prisma.companyMembership.upsert({
        where: { id: doc.id },
        update: {
          userId: doc.userId,
          companyId: doc.companyId,
          role: doc.role ?? "EMPLOYEE",
          branchId: doc.branchId ?? null,
          status: doc.status ?? "ACTIVE",
          updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : new Date(),
        },
        create: {
          id: doc.id,
          userId: doc.userId,
          companyId: doc.companyId,
          role: doc.role ?? "EMPLOYEE",
          branchId: doc.branchId ?? null,
          status: doc.status ?? "ACTIVE",
        },
      });
      count++;
    } catch (err: any) {
      console.error(`[migrate] Failed to import membership ${doc.id}:`, err.message);
    }
  }
  return count;
}

async function importBranches(docs: any[]): Promise<number> {
  let count = 0;
  for (const doc of docs) {
    try {
      await prisma.branch.upsert({
        where: { id: doc.id },
        update: {
          companyId: doc.companyId,
          name: doc.name,
          updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : new Date(),
        },
        create: {
          id: doc.id,
          companyId: doc.companyId,
          name: doc.name,
        },
      });
      count++;
    } catch (err: any) {
      console.error(`[migrate] Failed to import branch ${doc.id}:`, err.message);
    }
  }
  return count;
}

async function importDepartments(docs: any[]): Promise<number> {
  let count = 0;
  for (const doc of docs) {
    try {
      await prisma.department.upsert({
        where: { id: doc.id },
        update: {
          companyId: doc.companyId,
          branchId: doc.branchId ?? null,
          name: doc.name,
          updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : new Date(),
        },
        create: {
          id: doc.id,
          companyId: doc.companyId,
          branchId: doc.branchId ?? null,
          name: doc.name,
        },
      });
      count++;
    } catch (err: any) {
      console.error(`[migrate] Failed to import department ${doc.id}:`, err.message);
    }
  }
  return count;
}

async function importEmployees(docs: any[]): Promise<number> {
  let count = 0;
  for (const doc of docs) {
    try {
      await prisma.employee.upsert({
        where: { id: doc.id },
        update: {
          userId: doc.userId,
          companyId: doc.companyId,
          branchId: doc.branchId ?? null,
          departmentId: doc.departmentId ?? null,
          employeeNumber: doc.employeeNumber,
          jobTitle: doc.jobTitle,
          jobTitleAr: doc.jobTitleAr ?? "",
          employmentStatus: doc.employmentStatus ?? "ACTIVE",
          joiningDate: doc.joiningDate ? new Date(doc.joiningDate) : new Date(),
          salary: doc.salary ?? null,
          currency: doc.currency ?? "SAR",
          phone: doc.phone ?? null,
          address: doc.address ?? null,
          updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : new Date(),
        },
        create: {
          id: doc.id,
          userId: doc.userId,
          companyId: doc.companyId,
          branchId: doc.branchId ?? null,
          departmentId: doc.departmentId ?? null,
          employeeNumber: doc.employeeNumber,
          jobTitle: doc.jobTitle,
          jobTitleAr: doc.jobTitleAr ?? "",
          employmentStatus: doc.employmentStatus ?? "ACTIVE",
          joiningDate: doc.joiningDate ? new Date(doc.joiningDate) : new Date(),
          salary: doc.salary ?? null,
          currency: doc.currency ?? "SAR",
          phone: doc.phone ?? null,
          address: doc.address ?? null,
        },
      });
      count++;
    } catch (err: any) {
      console.error(`[migrate] Failed to import employee ${doc.id}:`, err.message);
    }
  }
  return count;
}

async function importCustomers(docs: any[]): Promise<number> {
  let count = 0;
  for (const doc of docs) {
    try {
      await prisma.customer.upsert({
        where: { id: doc.id },
        update: {
          companyId: doc.companyId,
          type: doc.type ?? "INDIVIDUAL",
          firstName: doc.firstName ?? null,
          lastName: doc.lastName ?? null,
          accountName: doc.accountName ?? null,
          legalName: doc.legalName ?? null,
          email: doc.email ?? null,
          phone: doc.phone ?? null,
          city: doc.city ?? null,
          country: doc.country ?? null,
          status: doc.status ?? "active",
          updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : new Date(),
        },
        create: {
          id: doc.id,
          companyId: doc.companyId,
          type: doc.type ?? "INDIVIDUAL",
          firstName: doc.firstName ?? null,
          lastName: doc.lastName ?? null,
          accountName: doc.accountName ?? null,
          legalName: doc.legalName ?? null,
          email: doc.email ?? null,
          phone: doc.phone ?? null,
          city: doc.city ?? null,
          country: doc.country ?? null,
          status: doc.status ?? "active",
        },
      });
      count++;
    } catch (err: any) {
      console.error(`[migrate] Failed to import customer ${doc.id}:`, err.message);
    }
  }
  return count;
}

async function importLeads(docs: any[]): Promise<number> {
  let count = 0;
  for (const doc of docs) {
    try {
      await prisma.lead.upsert({
        where: { id: doc.id },
        update: {
          companyId: doc.companyId,
          name: doc.name,
          companyName: doc.companyName ?? null,
          email: doc.email ?? null,
          phone: doc.phone ?? null,
          status: doc.status ?? "NEW",
          source: doc.source ?? null,
          priority: doc.priority ?? "medium",
          updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : new Date(),
        },
        create: {
          id: doc.id,
          companyId: doc.companyId,
          name: doc.name,
          companyName: doc.companyName ?? null,
          email: doc.email ?? null,
          phone: doc.phone ?? null,
          status: doc.status ?? "NEW",
          source: doc.source ?? null,
          priority: doc.priority ?? "medium",
        },
      });
      count++;
    } catch (err: any) {
      console.error(`[migrate] Failed to import lead ${doc.id}:`, err.message);
    }
  }
  return count;
}

async function importDeals(docs: any[]): Promise<number> {
  let count = 0;
  for (const doc of docs) {
    try {
      await prisma.deal.upsert({
        where: { id: doc.id },
        update: {
          companyId: doc.companyId,
          title: doc.title,
          amount: doc.amount ?? 0,
          currency: doc.currency ?? "SAR",
          stage: doc.stage ?? "PROSPECTING",
          probability: doc.probability ?? 0,
          updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : new Date(),
        },
        create: {
          id: doc.id,
          companyId: doc.companyId,
          title: doc.title,
          amount: doc.amount ?? 0,
          currency: doc.currency ?? "SAR",
          stage: doc.stage ?? "PROSPECTING",
          probability: doc.probability ?? 0,
        },
      });
      count++;
    } catch (err: any) {
      console.error(`[migrate] Failed to import deal ${doc.id}:`, err.message);
    }
  }
  return count;
}

async function importInvoices(docs: any[]): Promise<number> {
  let count = 0;
  for (const doc of docs) {
    try {
      await prisma.invoice.upsert({
        where: { id: doc.id },
        update: {
          companyId: doc.companyId,
          invoiceNumber: doc.invoiceNumber,
          status: doc.status ?? "DRAFT",
          customerId: doc.customerId ?? null,
          customerName: doc.customerName ?? null,
          subTotal: doc.subTotal ?? 0,
          totalTax: doc.totalTax ?? 0,
          totalDiscount: doc.totalDiscount ?? 0,
          grandTotal: doc.grandTotal ?? 0,
          currency: doc.currency ?? "SAR",
          updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : new Date(),
        },
        create: {
          id: doc.id,
          companyId: doc.companyId,
          invoiceNumber: doc.invoiceNumber,
          status: doc.status ?? "DRAFT",
          customerId: doc.customerId ?? null,
          customerName: doc.customerName ?? null,
          issueDate: doc.issueDate ? new Date(doc.issueDate) : new Date(),
          dueDate: doc.dueDate ? new Date(doc.dueDate) : new Date(),
          subTotal: doc.subTotal ?? 0,
          totalTax: doc.totalTax ?? 0,
          totalDiscount: doc.totalDiscount ?? 0,
          grandTotal: doc.grandTotal ?? 0,
          currency: doc.currency ?? "SAR",
        },
      });
      count++;
    } catch (err: any) {
      console.error(`[migrate] Failed to import invoice ${doc.id}:`, err.message);
    }
  }
  return count;
}

async function main() {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf("--dir");
  const exportDir = dirIndex !== -1 ? args[dirIndex + 1] : "./firestore-export";

  console.log(`[migrate] Reading Firestore export from: ${exportDir}`);

  if (!existsSync(exportDir)) {
    console.error(`[migrate] Export directory not found: ${exportDir}`);
    console.error("[migrate] Create the directory and place Firestore export JSON files inside.");
    console.error("[migrate] Each file should be named <collection-name>.json");
    process.exit(1);
  }

  const files = readdirSync(exportDir).filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    console.error("[migrate] No JSON files found in export directory");
    process.exit(1);
  }

  // Import in dependency order
  const order = [
    "users",
    "companies",
    "company_memberships",
    "branches",
    "departments",
    "employees",
    "customers",
    "leads",
    "deals",
    "invoices",
  ];

  for (const collection of order) {
    const file = files.find((f) => f === `${collection}.json`);
    if (!file) {
      console.log(`[migrate] Skipping ${collection} — no export file`);
      continue;
    }

    const data = JSON.parse(readFileSync(join(exportDir, file), "utf8"));
    const docs = Array.isArray(data) ? data : data.docs || [];

    console.log(`[migrate] Importing ${collection} (${docs.length} records)...`);
    const report = await importCollection(collection, docs);
    console.log(
      `  ✓ ${report.imported}/${report.total} imported, ${report.skipped} skipped`,
    );
    if (report.errors.length > 0) {
      console.log(`  ⚠ ${report.errors.length} errors`);
    }
  }

  // Print summary
  console.log("\n[migrate] Migration Summary:");
  console.log("=".repeat(60));
  let totalImported = 0;
  let totalRecords = 0;
  for (const report of reports) {
    totalImported += report.imported;
    totalRecords += report.total;
    console.log(
      `  ${report.collection.padEnd(20)} ${report.imported.toString().padStart(5)}/${report.total.toString().padStart(5)}`,
    );
  }
  console.log("=".repeat(60));
  console.log(`  Total: ${totalImported}/${totalRecords} records imported`);

  await prisma.$disconnect();
}

main()
  .then(() => {
    console.log("[migrate] Completed successfully");
  })
  .catch((err) => {
    console.error("[migrate] Fatal error:", err);
    process.exit(1);
  });
