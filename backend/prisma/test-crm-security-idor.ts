import { PrismaClient, DealStage } from "@prisma/client";
import { ContractsService } from "../src/crm/contracts.service";
import { QuotationsService } from "../src/crm/quotations.service";
import { CrmTasksService } from "../src/crm/crm-tasks.service";
import { NotesService } from "../src/crm/notes.service";
import { ClientReportsService } from "../src/crm/client-reports.service";
import { ContactClassificationsService } from "../src/crm/contact-classifications.service";
import { CustomersService } from "../src/crm/customers.service";
import { LeadsService } from "../src/crm/leads.service";
import { DealsService } from "../src/crm/deals.service";
import { ActivitiesService } from "../src/crm/activities.service";
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
    const companies = await prisma.company.findMany({ select: { id: true, name: true } });
    if (companies.length < 2) {
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
    const custB = await prisma.customer.create({
      data: {
        companyId: companyB,
        firstName: "Secret",
        lastName: "Client B",
        email: `secret-${Date.now()}@companyb.com`,
      },
    });

    try {
      await customersService.findOne(custB.id, companyA);
      assert("Company A cannot read Company B customer", false, "Allowed unauthorized read!");
    } catch (e: any) {
      assert("Company A cannot read Company B customer (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await customersService.update(custB.id, { firstName: "Hacked" }, companyA);
      assert("Company A cannot update Company B customer", false, "Allowed unauthorized write!");
    } catch (e: any) {
      assert("Company A cannot update Company B customer (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await customersService.remove(custB.id, companyA);
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
      await leadsService.findOne(leadB.id, companyA);
      assert("Company A cannot read Company B lead", false, "Allowed unauthorized read!");
    } catch (e: any) {
      assert("Company A cannot read Company B lead (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await leadsService.update(leadB.id, { name: "Compromised" }, companyA);
      assert("Company A cannot update Company B lead", false, "Allowed unauthorized write!");
    } catch (e: any) {
      assert("Company A cannot update Company B lead (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await leadsService.remove(leadB.id, companyA);
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
        stage: DealStage.PROSPECTING,
        amount: 5000000,
      },
    });

    try {
      await dealsService.findOne(dealB.id, companyA);
      assert("Company A cannot read Company B deal", false, "Allowed unauthorized read!");
    } catch (e: any) {
      assert("Company A cannot read Company B deal (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await dealsService.update(dealB.id, { title: "Hijacked Deal" }, companyA);
      assert("Company A cannot update Company B deal", false, "Allowed unauthorized write!");
    } catch (e: any) {
      assert("Company A cannot update Company B deal (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await dealsService.remove(dealB.id, companyA);
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
        title: "Secret Government Contract B",
        status: "draft",
        form: { contractNumber: `CNT-B-${Date.now()}`, value: 10000000 },
      },
    });

    try {
      await contractsService.findOne(contractB.id, companyA);
      assert("Company A cannot read Company B contract", false, "Allowed unauthorized read!");
    } catch (e: any) {
      assert("Company A cannot read Company B contract (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await contractsService.update(contractB.id, { title: "Intercepted Contract" }, companyA);
      assert("Company A cannot update Company B contract", false, "Allowed unauthorized write!");
    } catch (e: any) {
      assert("Company A cannot update Company B contract (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await contractsService.remove(contractB.id, companyA);
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
        title: "Proprietary Price Quote B",
        total: 250000,
        status: "draft",
        form: { quoteNumber: `QT-B-${Date.now()}` },
      },
    });

    try {
      await quotationsService.findOne(quoteB.id, companyA);
      assert("Company A cannot read Company B quotation", false, "Allowed unauthorized read!");
    } catch (e: any) {
      assert("Company A cannot read Company B quotation (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await quotationsService.update(quoteB.id, { title: "Altered Quote" }, companyA);
      assert("Company A cannot update Company B quotation", false, "Allowed unauthorized write!");
    } catch (e: any) {
      assert("Company A cannot update Company B quotation (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await quotationsService.remove(quoteB.id, companyA);
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
        priority: "high",
        entityType: "contact",
        entityId: custB.id,
      },
    });

    try {
      await tasksService.findOne(taskB.id, companyA);
      assert("Company A cannot read Company B task", false, "Allowed unauthorized read!");
    } catch (e: any) {
      assert("Company A cannot read Company B task (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await tasksService.update(taskB.id, { title: "Hijacked Task" }, companyA);
      assert("Company A cannot update Company B task", false, "Allowed unauthorized write!");
    } catch (e: any) {
      assert("Company A cannot update Company B task (404/NotFound)", e instanceof NotFoundException);
    }

    try {
      await tasksService.remove(taskB.id, companyA);
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
    const custA = await prisma.customer.create({
      data: {
        companyId: companyA,
        firstName: "Client",
        lastName: "Expired A",
        email: `expired-${Date.now()}@companya.com`,
      },
    });

    const expiredDate = new Date();
    expiredDate.setDate(expiredDate.getDate() - 1);
    const expiredReport = await prisma.crmClientReport.create({
      data: {
        companyId: companyA,
        contactId: custA.id,
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
    await prisma.customer.deleteMany({ where: { id: { in: [custB.id, custA.id] } } });
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
