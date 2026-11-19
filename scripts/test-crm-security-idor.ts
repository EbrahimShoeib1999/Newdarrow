import { PrismaClient } from "../backend/node_modules/@prisma/client";
import { ContractsService } from "../backend/src/crm/contracts.service";
import { QuotationsService } from "../backend/src/crm/quotations.service";
import { CrmTasksService } from "../backend/src/crm/crm-tasks.service";
import { NotesService } from "../backend/src/crm/notes.service";
import { AttachmentsService } from "../backend/src/crm/attachments.service";
import { ClientReportsService } from "../backend/src/crm/client-reports.service";
import { ContactClassificationsService } from "../backend/src/crm/contact-classifications.service";
import { CustomersService } from "../backend/src/crm/customers.service";
import { LeadsService } from "../backend/src/crm/leads.service";
import { DealsService } from "../backend/src/crm/deals.service";
import { ActivitiesService } from "../backend/src/crm/activities.service";
import { NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";

const prisma = new PrismaClient();

async function runLiveSecurityAndIdorSuite() {
  console.log("================================================================================");
  console.log(" D-ARROW CRM — LIVE SECURITY, IDOR & TENANT ISOLATION SUITE");
  console.log("================================================================================");

  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name} ${detail ? `- ${detail}` : ""}`);
      failed++;
    }
  }

  try {
    // 1. Identify companies in database
    const companies = await prisma.company.findMany({ select: { id: true, name: true } });
    console.log(`Discovered ${companies.length} companies in local database:`);
    companies.forEach((c) => console.log(` - ${c.name} (${c.id})`));

    if (companies.length < 2) {
      console.log("Creating a temporary second company for IDOR attack verification...");
      const dummyCompanyB = await prisma.company.upsert({
        where: { id: "test-idor-company-b" },
        update: {},
        create: {
          id: "test-idor-company-b",
          name: "IDOR Attack Target Corp",
          slug: "idor-target-corp",
          currency: "SAR",
        },
      });
      companies.push(dummyCompanyB);
    }

    const companyA = companies[0].id;
    const companyB = companies[1].id;
    console.log(`Testing IDOR between Company A (${companyA}) and Company B (${companyB})\n`);

    // Setup services with real Prisma
    const contractsService = new ContractsService(prisma as any);
    const quotationsService = new QuotationsService(prisma as any);
    const tasksService = new CrmTasksService(prisma as any);
    const notesService = new NotesService(prisma as any);
    const reportsService = new ClientReportsService(prisma as any);
    const classificationsService = new ContactClassificationsService(prisma as any);
    const customersService = new CustomersService(prisma as any);
    const leadsService = new LeadsService(prisma as any);
    const dealsService = new DealsService(prisma as any);
    const activitiesService = new ActivitiesService(prisma as any);

    // -------------------------------------------------------------------------
    // TEST 1: Database Table Integrity - Zero Orphan / Zero Missing companyId
    // -------------------------------------------------------------------------
    console.log("--- 1. Database Multi-Tenant Column Integrity ---");
    const crmTables = [
      { name: "Customer", count: await prisma.customer.count({ where: { companyId: "" } }) },
      { name: "Lead", count: await prisma.lead.count({ where: { companyId: "" } }) },
      { name: "Deal", count: await prisma.deal.count({ where: { companyId: "" } }) },
      { name: "CrmActivity", count: await prisma.crmActivity.count({ where: { companyId: "" } }) },
      { name: "CrmNotification", count: await prisma.crmNotification.count({ where: { companyId: "" } }) },
      { name: "CrmContract", count: await prisma.crmContract.count({ where: { companyId: "" } }) },
      { name: "CrmQuotation", count: await prisma.crmQuotation.count({ where: { companyId: "" } }) },
      { name: "CrmTask", count: await prisma.crmTask.count({ where: { companyId: "" } }) },
      { name: "CrmNote", count: await prisma.crmNote.count({ where: { companyId: "" } }) },
      { name: "CrmAttachment", count: await prisma.crmAttachment.count({ where: { companyId: "" } }) },
      { name: "CrmClientReport", count: await prisma.crmClientReport.count({ where: { companyId: "" } }) },
      { name: "CrmContactClassification", count: await prisma.crmContactClassification.count({ where: { companyId: "" } }) },
    ];

    for (const t of crmTables) {
      assert(`Table ${t.name} has no empty/null companyId records`, t.count === 0, `found ${t.count} empty companyId records`);
    }

    // -------------------------------------------------------------------------
    // TEST 2: IDOR on Customers / Contacts
    // -------------------------------------------------------------------------
    console.log("\n--- 2. IDOR on Customers (Contacts) ---");
    // Create a target record for Company B
    const custB = await prisma.customer.create({
      data: {
        companyId: companyB,
        firstName: "Secret",
        lastName: "Client B",
        email: `secret-${Date.now()}@companyb.com`,
      },
    });

    // Company A attempts to find, update, and delete Company B's customer
    try {
      await customersService.findOne(companyA, custB.id);
      assert("Company A cannot read Company B customer", false, "Allowed unauthorized read!");
    } catch (e: any) {
      assert("Company A cannot read Company B customer (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await customersService.update(companyA, custB.id, { firstName: "Hacked" });
      assert("Company A cannot update Company B customer", false, "Allowed unauthorized write!");
    } catch (e: any) {
      assert("Company A cannot update Company B customer (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await customersService.remove(companyA, custB.id);
      assert("Company A cannot delete Company B customer", false, "Allowed unauthorized delete!");
    } catch (e: any) {
      assert("Company A cannot delete Company B customer (404/NotFound)", e instanceof NotFoundException);
    }

    // -------------------------------------------------------------------------
    // TEST 3: IDOR on Leads
    // -------------------------------------------------------------------------
    console.log("\n--- 3. IDOR on Leads ---");
    const leadB = await prisma.lead.create({
      data: {
        companyId: companyB,
        name: "Confidential Lead B",
        status: "NEW",
      },
    });

    try {
      await leadsService.findOne(companyA, leadB.id);
      assert("Company A cannot read Company B lead", false, "Allowed unauthorized read!");
    } catch (e: any) {
      assert("Company A cannot read Company B lead (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await leadsService.update(companyA, leadB.id, { name: "Compromised" });
      assert("Company A cannot update Company B lead", false, "Allowed unauthorized write!");
    } catch (e: any) {
      assert("Company A cannot update Company B lead (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await leadsService.remove(companyA, leadB.id);
      assert("Company A cannot delete Company B lead", false, "Allowed unauthorized delete!");
    } catch (e: any) {
      assert("Company A cannot delete Company B lead (404/NotFound)", e instanceof NotFoundException);
    }

    // -------------------------------------------------------------------------
    // TEST 4: IDOR on Deals
    // -------------------------------------------------------------------------
    console.log("\n--- 4. IDOR on Deals ---");
    const dealB = await prisma.deal.create({
      data: {
        companyId: companyB,
        title: "Confidential Mega Deal B",
        stage: "LEAD",
        amount: 5000000,
      },
    });

    try {
      await dealsService.findOne(companyA, dealB.id);
      assert("Company A cannot read Company B deal", false, "Allowed unauthorized read!");
    } catch (e: any) {
      assert("Company A cannot read Company B deal (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await dealsService.update(companyA, dealB.id, { title: "Hijacked Deal" });
      assert("Company A cannot update Company B deal", false, "Allowed unauthorized write!");
    } catch (e: any) {
      assert("Company A cannot update Company B deal (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await dealsService.remove(companyA, dealB.id);
      assert("Company A cannot delete Company B deal", false, "Allowed unauthorized delete!");
    } catch (e: any) {
      assert("Company A cannot delete Company B deal (404/NotFound)", e instanceof NotFoundException);
    }

    // -------------------------------------------------------------------------
    // TEST 5: IDOR on Contracts
    // -------------------------------------------------------------------------
    console.log("\n--- 5. IDOR on Contracts ---");
    const contractB = await prisma.crmContract.create({
      data: {
        companyId: companyB,
        contractNumber: `CNT-B-${Date.now()}`,
        title: "Secret Government Contract B",
        value: 10000000,
        status: "draft",
      },
    });

    try {
      await contractsService.findById(companyA, contractB.id);
      assert("Company A cannot read Company B contract", false, "Allowed unauthorized read!");
    } catch (e: any) {
      assert("Company A cannot read Company B contract (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await contractsService.update(companyA, contractB.id, { title: "Intercepted Contract" });
      assert("Company A cannot update Company B contract", false, "Allowed unauthorized write!");
    } catch (e: any) {
      assert("Company A cannot update Company B contract (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await contractsService.remove(companyA, contractB.id);
      assert("Company A cannot delete Company B contract", false, "Allowed unauthorized delete!");
    } catch (e: any) {
      assert("Company A cannot delete Company B contract (404/NotFound)", e instanceof NotFoundException);
    }

    // -------------------------------------------------------------------------
    // TEST 6: IDOR on Quotations
    // -------------------------------------------------------------------------
    console.log("\n--- 6. IDOR on Quotations ---");
    const quoteB = await prisma.crmQuotation.create({
      data: {
        companyId: companyB,
        quotationNumber: `QT-B-${Date.now()}`,
        title: "Proprietary Price Quote B",
        total: 250000,
        status: "draft",
      },
    });

    try {
      await quotationsService.findById(companyA, quoteB.id);
      assert("Company A cannot read Company B quotation", false, "Allowed unauthorized read!");
    } catch (e: any) {
      assert("Company A cannot read Company B quotation (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await quotationsService.update(companyA, quoteB.id, { title: "Altered Quote" });
      assert("Company A cannot update Company B quotation", false, "Allowed unauthorized write!");
    } catch (e: any) {
      assert("Company A cannot update Company B quotation (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await quotationsService.remove(companyA, quoteB.id);
      assert("Company A cannot delete Company B quotation", false, "Allowed unauthorized delete!");
    } catch (e: any) {
      assert("Company A cannot delete Company B quotation (404/NotFound)", e instanceof NotFoundException);
    }

    // -------------------------------------------------------------------------
    // TEST 7: IDOR on CRM Tasks
    // -------------------------------------------------------------------------
    console.log("\n--- 7. IDOR on CRM Tasks ---");
    const taskB = await prisma.crmTask.create({
      data: {
        companyId: companyB,
        title: "Confidential Executive Review B",
        taskType: "call",
        priority: "urgent",
      },
    });

    try {
      await tasksService.findById(companyA, taskB.id);
      assert("Company A cannot read Company B task", false, "Allowed unauthorized read!");
    } catch (e: any) {
      assert("Company A cannot read Company B task (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await tasksService.update(companyA, taskB.id, { title: "Hijacked Task" });
      assert("Company A cannot update Company B task", false, "Allowed unauthorized write!");
    } catch (e: any) {
      assert("Company A cannot update Company B task (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await tasksService.remove(companyA, taskB.id);
      assert("Company A cannot delete Company B task", false, "Allowed unauthorized delete!");
    } catch (e: any) {
      assert("Company A cannot delete Company B task (404/NotFound)", e instanceof NotFoundException);
    }

    // -------------------------------------------------------------------------
    // TEST 8: IDOR on CRM Notes
    // -------------------------------------------------------------------------
    console.log("\n--- 8. IDOR on CRM Notes ---");
    const noteB = await prisma.crmNote.create({
      data: {
        companyId: companyB,
        content: "Highly sensitive insider meeting notes for Company B",
        entityType: "contact",
        entityId: custB.id,
        authorId: "user-b",
        authorName: "Agent B",
      },
    });

    try {
      await notesService.findById(companyA, noteB.id);
      assert("Company A cannot read Company B note", false, "Allowed unauthorized read!");
    } catch (e: any) {
      assert("Company A cannot read Company B note (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await notesService.update(companyA, noteB.id, { content: "Tampered note" });
      assert("Company A cannot update Company B note", false, "Allowed unauthorized write!");
    } catch (e: any) {
      assert("Company A cannot update Company B note (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await notesService.remove(companyA, noteB.id);
      assert("Company A cannot delete Company B note", false, "Allowed unauthorized delete!");
    } catch (e: any) {
      assert("Company A cannot delete Company B note (404/NotFound)", e instanceof NotFoundException);
    }

    // -------------------------------------------------------------------------
    // TEST 9: IDOR & Security on Client Reports & Public Endpoints
    // -------------------------------------------------------------------------
    console.log("\n--- 9. IDOR and Public Security on Client Reports ---");
    const reportB = await prisma.crmClientReport.create({
      data: {
        companyId: companyB,
        contactId: custB.id,
        contactName: "Client B",
        authorId: "user-b",
        authorName: "Agent B",
        title: "Confidential Strategy Report B",
        content: "Detailed market acquisition strategy for Company B",
        internalNotes: "CONFIDENTIAL INTERNAL EXECUTIVE NOTE - MUST NEVER BE LEAKED",
        status: "approved",
      },
    });

    // Cross-company read via authenticated service
    try {
      await reportsService.findById(companyA, reportB.id);
      assert("Company A cannot read Company B client report", false, "Allowed unauthorized read!");
    } catch (e: any) {
      assert("Company A cannot read Company B client report (404/NotFound)", e instanceof NotFoundException);
    }

    // Public view via ID when public access is NOT revoked
    const publicViewRes = await reportsService.findPublicReportById(companyB, reportB.id);
    assert("Public report view succeeds for valid public report", publicViewRes.id === reportB.id);
    assert("Public report view strictly strips internalNotes", (publicViewRes as any).internalNotes === undefined);

    // Revoke public view and verify denial
    await reportsService.revokePublicToken(companyB, reportB.id);
    try {
      await reportsService.findPublicReportById(companyB, reportB.id);
      assert("Revoked public report cannot be viewed by ID", false, "Allowed revoked access!");
    } catch (e: any) {
      assert("Revoked public report throws ForbiddenException", e instanceof ForbiddenException);
    }

    // Expired public view check
    const expiredDate = new Date();
    expiredDate.setDate(expiredDate.getDate() - 1);
    const expiredReport = await prisma.crmClientReport.create({
      data: {
        companyId: companyA,
        contactId: "cnt-1",
        contactName: "Client Expired",
        authorId: "user-a",
        authorName: "Agent A",
        title: "Expired Public Report",
        content: "Content should be expired",
        isPublicRevoked: false,
        publicTokenExpiresAt: expiredDate,
        status: "approved",
      },
    });

    try {
      await reportsService.findPublicReportById(companyA, expiredReport.id);
      assert("Expired public report cannot be viewed by ID", false, "Allowed expired access!");
    } catch (e: any) {
      assert("Expired public report throws ForbiddenException", e instanceof ForbiddenException);
    }

    // -------------------------------------------------------------------------
    // Clean up temporary IDOR test records
    // -------------------------------------------------------------------------
    console.log("\n--- Cleaning up temporary IDOR probe records ---");
    await prisma.crmClientReport.deleteMany({ where: { id: { in: [reportB.id, expiredReport.id] } } });
    await prisma.crmNote.deleteMany({ where: { id: noteB.id } });
    await prisma.crmTask.deleteMany({ where: { id: taskB.id } });
    await prisma.crmQuotation.deleteMany({ where: { id: quoteB.id } });
    await prisma.crmContract.deleteMany({ where: { id: contractB.id } });
    await prisma.deal.deleteMany({ where: { id: dealB.id } });
    await prisma.lead.deleteMany({ where: { id: leadB.id } });
    await prisma.customer.deleteMany({ where: { id: custB.id } });
    if (companies.some((c) => c.id === "test-idor-company-b")) {
      await prisma.company.delete({ where: { id: "test-idor-company-b" } }).catch(() => {});
    }
    console.log("Cleanup complete.");

    console.log("\n================================================================================");
    console.log(` SUITE RESULT: Passed: ${passed} | Failed: ${failed}`);
    console.log("================================================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Suite encountered error:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runLiveSecurityAndIdorSuite();
