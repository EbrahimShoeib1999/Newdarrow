import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app-setup";
import { PrismaService } from "../src/common/prisma.service";
import { DealStage } from "@prisma/client";

const UNIQUE = Date.now().toString(36);

describe("CRM Deals (e2e) — Tenant Isolation & CRUD", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let companyAId: string;
  let userAId: string;
  let tokenA: string;

  let companyBId: string;
  let userBId: string;
  let tokenB: string;

  let userEmpId: string;
  let tokenEmp: string;

  let customerAId: string;
  let leadAId: string;
  let customerBId: string;
  let leadBId: string;

  let dealA1Id: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleRef.get(PrismaService);

    // Database safety check
    const result = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      "SELECT current_database() AS current_database",
    );
    if (result[0]?.current_database !== "darrow_dev") {
      throw new Error(`Unexpected database target: ${result[0]?.current_database}. Must be darrow_dev.`);
    }

    // Register Company A + User A (Owner/Admin with crm.delete)
    const emailA = `crm-deals-a-${UNIQUE}@darrow.test`;
    const resA = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: emailA,
        password: "Password123!",
        name: "User Deals A",
        companyName: `Company Deals A ${UNIQUE}`,
      })
      .expect(201);

    userAId = resA.body.data.id;
    const membershipA = await prisma.companyMembership.findUnique({ where: { userId: userAId } });
    companyAId = membershipA!.companyId;

    const loginResA = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: emailA, password: "Password123!" })
      .expect(200);
    tokenA = loginResA.body.data.accessToken;

    // Create a Customer in Company A
    const custA = await prisma.customer.create({
      data: {
        companyId: companyAId,
        firstName: "CustA",
        lastName: "One",
        accountName: "Company A Client",
      },
    });
    customerAId = custA.id;

    // Create a Lead in Company A
    const leadA = await prisma.lead.create({
      data: {
        companyId: companyAId,
        name: "LeadA One",
      },
    });
    leadAId = leadA.id;

    // Register Company B + User B (Owner/Admin)
    const emailB = `crm-deals-b-${UNIQUE}@darrow.test`;
    const resB = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: emailB,
        password: "Password123!",
        name: "User Deals B",
        companyName: `Company Deals B ${UNIQUE}`,
      })
      .expect(201);

    userBId = resB.body.data.id;
    const membershipB = await prisma.companyMembership.findUnique({ where: { userId: userBId } });
    companyBId = membershipB!.companyId;

    const loginResB = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: emailB, password: "Password123!" })
      .expect(200);
    tokenB = loginResB.body.data.accessToken;

    // Create a Customer in Company B (for cross-tenant validation)
    const custB = await prisma.customer.create({
      data: {
        companyId: companyBId,
        firstName: "CustB",
        lastName: "One",
        accountName: "Company B Client",
      },
    });
    customerBId = custB.id;

    // Create a Lead in Company B (for cross-tenant validation)
    const leadB = await prisma.lead.create({
      data: {
        companyId: companyBId,
        name: "LeadB One",
      },
    });
    leadBId = leadB.id;

    // Register Employee in Company A (without crm.delete)
    const emailEmp = `crm-deals-emp-${UNIQUE}@darrow.test`;
    const resEmp = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: emailEmp,
        password: "Password123!",
        name: "Employee Deals A (No Delete)",
      })
      .expect(201);

    userEmpId = resEmp.body.data.id;
    await prisma.companyMembership.create({
      data: {
        userId: userEmpId,
        companyId: companyAId,
        role: "EMPLOYEE",
        status: "ACTIVE",
      },
    });

    const loginResEmp = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: emailEmp, password: "Password123!" })
      .expect(200);
    tokenEmp = loginResEmp.body.data.accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      if (userEmpId) {
        await prisma.companyMembership.deleteMany({ where: { userId: userEmpId } });
        await prisma.refreshToken.deleteMany({ where: { userId: userEmpId } });
        await prisma.user.deleteMany({ where: { id: userEmpId } });
      }
      if (userBId) {
        await prisma.deal.deleteMany({ where: { companyId: companyBId } });
        await prisma.lead.deleteMany({ where: { companyId: companyBId } });
        await prisma.customer.deleteMany({ where: { companyId: companyBId } });
        await prisma.companyMembership.deleteMany({ where: { userId: userBId } });
        await prisma.refreshToken.deleteMany({ where: { userId: userBId } });
        await prisma.user.deleteMany({ where: { id: userBId } });
        await prisma.company.deleteMany({ where: { id: companyBId } });
      }
      if (userAId) {
        await prisma.deal.deleteMany({ where: { companyId: companyAId } });
        await prisma.lead.deleteMany({ where: { companyId: companyAId } });
        await prisma.customer.deleteMany({ where: { companyId: companyAId } });
        await prisma.companyMembership.deleteMany({ where: { userId: userAId } });
        await prisma.refreshToken.deleteMany({ where: { userId: userAId } });
        await prisma.user.deleteMany({ where: { id: userAId } });
        await prisma.company.deleteMany({ where: { id: companyAId } });
      }
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  describe("Authentication Requirements", () => {
    it("rejects unauthenticated GET /api/v1/crm/deals with 401", async () => {
      await request(app.getHttpServer()).get("/api/v1/crm/deals").expect(401);
    });

    it("rejects unauthenticated POST /api/v1/crm/deals with 401", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/crm/deals")
        .send({ title: "Unauth Deal" })
        .expect(401);
    });

    it("rejects unauthenticated GET /api/v1/crm/deals/:id with 401", async () => {
      await request(app.getHttpServer()).get("/api/v1/crm/deals/dummy-id").expect(401);
    });

    it("rejects unauthenticated PATCH /api/v1/crm/deals/:id with 401", async () => {
      await request(app.getHttpServer())
        .patch("/api/v1/crm/deals/dummy-id")
        .send({ title: "Updated" })
        .expect(401);
    });

    it("rejects unauthenticated DELETE /api/v1/crm/deals/:id with 401", async () => {
      await request(app.getHttpServer()).delete("/api/v1/crm/deals/dummy-id").expect(401);
    });
  });

  describe("Deal CRUD & Single Response Envelope", () => {
    it("creates a deal in Company A with single response envelope and valid stage mapping", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/deals")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          title: "Enterprise Deal A",
          amount: 50000,
          currency: "SAR",
          stage: "lead",
          probability: 2,
          contactId: customerAId,
          leadId: leadAId,
        })
        .expect(201);

      expect(res.body).toHaveProperty("data");
      expect(res.body).toHaveProperty("message", "Deal created");
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.title).toBe("Enterprise Deal A");
      expect(res.body.data.amount).toBe(50000);
      expect(res.body.data.stage).toBe(DealStage.PROSPECTING);
      expect(res.body.data.companyId).toBe(companyAId);
      expect(res.body.data.contactId).toBe(customerAId);
      expect(res.body.data.leadId).toBe(leadAId);

      // Verify NO double envelope
      expect(res.body.data.data).toBeUndefined();

      dealA1Id = res.body.data.id;
    });

    it("prevents client companyId tampering on creation", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/deals")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          title: "Spoofed Company Deal",
          companyId: companyBId, // Attempt to spoof Company B
          amount: 10000,
        })
        .expect(201);

      // Enforced to Company A
      expect(res.body.data.companyId).toBe(companyAId);
      expect(res.body.data.companyId).not.toBe(companyBId);

      // Clean up spoofed deal
      await prisma.deal.delete({ where: { id: res.body.data.id } });
    });

    it("retrieves the created deal for Company A", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/crm/deals/${dealA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body).toHaveProperty("data");
      expect(res.body.data.id).toBe(dealA1Id);
      expect(res.body.data.title).toBe("Enterprise Deal A");
      expect(res.body.data.contact).toBeDefined();
      expect(res.body.data.contact.firstName).toBe("CustA");
    });

    it("updates the deal for Company A (stage transition to proposal_sent)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/crm/deals/${dealA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          title: "Enterprise Deal A - Updated",
          amount: 75000,
          stage: "proposal_sent",
          probability: 6,
        })
        .expect(200);

      expect(res.body).toHaveProperty("data");
      expect(res.body.data.title).toBe("Enterprise Deal A - Updated");
      expect(res.body.data.amount).toBe(75000);
      expect(res.body.data.stage).toBe(DealStage.VALUE_PROPOSAL);
      expect(res.body.data.probability).toBe(6);
    });
  });

  describe("Cross-Company Relation Prevention", () => {
    it("rejects linking a deal to a contact belonging to another company (400)", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/deals")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          title: "Invalid Cross-Tenant Deal",
          contactId: customerBId, // Belongs to Company B!
          amount: 5000,
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it("rejects updating a deal with a contact belonging to another company (400)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/crm/deals/${dealA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          contactId: customerBId, // Belongs to Company B!
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain("Contact not found or does not belong to your company");
    });

    it("rejects linking a deal to a lead belonging to another company (400)", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/deals")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          title: "Invalid Cross-Tenant Lead Deal",
          leadId: leadBId, // Belongs to Company B!
          amount: 5000,
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain("Lead not found or does not belong to your company");
    });

    it("rejects updating a deal with a lead belonging to another company (400)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/crm/deals/${dealA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          leadId: leadBId, // Belongs to Company B!
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain("Lead not found or does not belong to your company");
    });
  });

  describe("Cross-Company & Tenant Assignment (assignedToId) Validation", () => {
    let dealWithAssigneeId: string;

    it("1. Same-company assigned user can be assigned successfully on create", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/deals")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          title: "Deal with Valid Assignee",
          amount: 25000,
          assignedToId: userEmpId, // Valid active user in Company A
        })
        .expect(201);

      expect(res.body).toHaveProperty("data");
      expect(res.body.data.assignedToId).toBe(userEmpId);
      expect(res.body.data.assignedTo).toBeDefined();
      expect(res.body.data.assignedTo.id).toBe(userEmpId);

      // Verify database state
      const dbDeal = await prisma.deal.findUnique({ where: { id: res.body.data.id } });
      expect(dbDeal).not.toBeNull();
      expect(dbDeal!.assignedToId).toBe(userEmpId);

      dealWithAssigneeId = res.body.data.id;
    });

    it("2. Cross-company assigned user is rejected on create (400)", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/deals")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          title: "Deal with Cross-Company Assignee",
          amount: 30000,
          assignedToId: userBId, // Belongs to Company B!
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain("Assigned user not found or does not belong to your company");

      // Verify no deal was created in database
      const dbDeal = await prisma.deal.findFirst({
        where: { title: "Deal with Cross-Company Assignee", companyId: companyAId },
      });
      expect(dbDeal).toBeNull();
    });

    it("3. Nonexistent assigned user is rejected appropriately on create (400)", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/deals")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          title: "Deal with Nonexistent Assignee",
          amount: 15000,
          assignedToId: "00000000-0000-0000-0000-000000000000",
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain("Assigned user not found or does not belong to your company");

      // Verify no deal was created in database
      const dbDeal = await prisma.deal.findFirst({
        where: { title: "Deal with Nonexistent Assignee", companyId: companyAId },
      });
      expect(dbDeal).toBeNull();
    });

    it("4. A forged companyId in the request cannot bypass the validation", async () => {
      // Attacker from Company A tries to pass companyId: companyBId to assign userBId
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/deals")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          title: "Deal with Forged Company and Assignee",
          companyId: companyBId, // Forged companyId
          amount: 20000,
          assignedToId: userBId, // Belongs to Company B
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain("Assigned user not found or does not belong to your company");

      // Verify no deal was created in either company
      const dbDealA = await prisma.deal.findFirst({
        where: { title: "Deal with Forged Company and Assignee", companyId: companyAId },
      });
      const dbDealB = await prisma.deal.findFirst({
        where: { title: "Deal with Forged Company and Assignee", companyId: companyBId },
      });
      expect(dbDealA).toBeNull();
      expect(dbDealB).toBeNull();
    });

    it("5. Updating a Deal to assign a user from another company is rejected (400)", async () => {
      // Capture pre-update state
      const preUpdateDeal = await prisma.deal.findUnique({ where: { id: dealWithAssigneeId } });
      expect(preUpdateDeal).not.toBeNull();
      expect(preUpdateDeal!.assignedToId).toBe(userEmpId);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/crm/deals/${dealWithAssigneeId}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          title: "Hacked Deal Title",
          amount: 999999,
          assignedToId: userBId, // Belongs to Company B!
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain("Assigned user not found or does not belong to your company");

      // Verify persisted database state after rejected request: NOT partially updated!
      const postUpdateDeal = await prisma.deal.findUnique({ where: { id: dealWithAssigneeId } });
      expect(postUpdateDeal).not.toBeNull();
      expect(postUpdateDeal!.assignedToId).toBe(userEmpId); // Unchanged!
      expect(postUpdateDeal!.title).toBe(preUpdateDeal!.title); // Unchanged!
      expect(postUpdateDeal!.amount).toBe(preUpdateDeal!.amount); // Unchanged!
    });

    it("6. Updating a Deal without an assignment field preserves the existing assignment", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/crm/deals/${dealWithAssigneeId}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          title: "Deal with Preserved Assignee",
          amount: 40000,
        })
        .expect(200);

      expect(res.body).toHaveProperty("data");
      expect(res.body.data.title).toBe("Deal with Preserved Assignee");
      expect(res.body.data.amount).toBe(40000);
      expect(res.body.data.assignedToId).toBe(userEmpId);
      expect(res.body.data.assignedTo.id).toBe(userEmpId);

      // Verify database state
      const dbDeal = await prisma.deal.findUnique({ where: { id: dealWithAssigneeId } });
      expect(dbDeal!.assignedToId).toBe(userEmpId);
      expect(dbDeal!.title).toBe("Deal with Preserved Assignee");
    });

    it("7. Explicit unassignment continues to work (sets assignedToId to null)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/crm/deals/${dealWithAssigneeId}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          assignedToId: null,
        })
        .expect(200);

      expect(res.body).toHaveProperty("data");
      expect(res.body.data.assignedToId).toBeNull();
      expect(res.body.data.assignedTo).toBeNull();

      // Verify database state
      const dbDeal = await prisma.deal.findUnique({ where: { id: dealWithAssigneeId } });
      expect(dbDeal!.assignedToId).toBeNull();
    });
  });

  describe("Tenant Isolation Between Companies", () => {
    it("Company B user cannot view Company A deals list", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/crm/deals")
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body).toHaveProperty("data");
      const deals = res.body.data;
      const found = deals.find((d: any) => d.id === dealA1Id);
      expect(found).toBeUndefined();
    });

    it("Company B user cannot retrieve Company A deal by ID (404)", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/crm/deals/${dealA1Id}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(404);
    });

    it("Company B user cannot update Company A deal (404)", async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/crm/deals/${dealA1Id}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .send({ title: "Hacked" })
        .expect(404);
    });

    it("Company B user cannot delete Company A deal (404)", async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/crm/deals/${dealA1Id}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(404);
    });
  });

  describe("Backend RBAC Authorization for Deletion", () => {
    it("rejects DELETE from authenticated employee without crm.delete permission with 403 Forbidden", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/crm/deals/${dealA1Id}`)
        .set("Authorization", `Bearer ${tokenEmp}`)
        .expect(403);

      expect(res.body.message).toContain("crm.delete");

      // Verify deal was NOT deleted and remains active in database
      const dbDeal = await prisma.deal.findUnique({ where: { id: dealA1Id } });
      expect(dbDeal).not.toBeNull();
      expect(dbDeal!.deletedAt).toBeNull();
    });

    it("allows DELETE from authenticated admin with crm.delete permission with 200 OK and soft-deletes", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/crm/deals/${dealA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.data.removed).toBe(true);
      expect(res.body.message).toBe("Deal deleted");

      // Verify soft deletion in database
      const dbDeal = await prisma.deal.findUnique({ where: { id: dealA1Id } });
      expect(dbDeal).not.toBeNull();
      expect(dbDeal!.deletedAt).not.toBeNull();

      // Verify GET :id returns 404
      await request(app.getHttpServer())
        .get(`/api/v1/crm/deals/${dealA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(404);

      // Verify deal no longer appears in Company A list
      const listRes = await request(app.getHttpServer())
        .get("/api/v1/crm/deals")
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      const found = listRes.body.data.find((d: any) => d.id === dealA1Id);
      expect(found).toBeUndefined();
    });
  });
});
