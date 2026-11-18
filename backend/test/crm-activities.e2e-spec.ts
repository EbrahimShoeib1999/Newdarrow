import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app-setup";
import { PrismaService } from "../src/common/prisma.service";

const UNIQUE = Date.now().toString(36);

describe("CRM Activities (e2e) — Tenant Isolation & CRUD", () => {
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

  let activityA1Id: string;

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

    // Register Company A + User A (Owner/Admin)
    const emailA = `crm-act-a-${UNIQUE}@darrow.test`;
    const resA = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: emailA,
        password: "Password123!",
        name: "User Act A",
        companyName: `Company Act A ${UNIQUE}`,
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

    // Create Customer A & Lead A in Company A
    const custA = await prisma.customer.create({
      data: {
        companyId: companyAId,
        firstName: "CustA",
        lastName: "One",
        accountName: "Company A Client",
      },
    });
    customerAId = custA.id;

    const leadA = await prisma.lead.create({
      data: {
        companyId: companyAId,
        name: "LeadA One",
      },
    });
    leadAId = leadA.id;

    // Register Company B + User B
    const emailB = `crm-act-b-${UNIQUE}@darrow.test`;
    const resB = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: emailB,
        password: "Password123!",
        name: "User Act B",
        companyName: `Company Act B ${UNIQUE}`,
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

    // Create Customer B & Lead B in Company B
    const custB = await prisma.customer.create({
      data: {
        companyId: companyBId,
        firstName: "CustB",
        lastName: "One",
        accountName: "Company B Client",
      },
    });
    customerBId = custB.id;

    const leadB = await prisma.lead.create({
      data: {
        companyId: companyBId,
        name: "LeadB One",
      },
    });
    leadBId = leadB.id;

    // Register Employee in Company A (without crm.delete)
    const emailEmp = `crm-act-emp-${UNIQUE}@darrow.test`;
    const resEmp = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: emailEmp,
        password: "Password123!",
        name: "Employee Act A (No Delete)",
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
    if (app) {
      await app.close();
    }
  });

  describe("POST /api/v1/crm/activities — Create Activity & Tenant Validation", () => {
    it("creates an activity linked to a Customer in the same company", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/activities")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          subject: "Initial discovery call",
          description: "Discussed project scope with client",
          entityType: "contact",
          entityId: customerAId,
          type: "call",
          durationMinutes: 30,
        })
        .expect(201);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.subject).toBe("Initial discovery call");
      expect(res.body.data.type).toBe("call");
      expect(res.body.data.entityType).toBe("contact");
      expect(res.body.data.entityId).toBe(customerAId);
      expect(res.body.data.userId).toBe(userAId);

      activityA1Id = res.body.data.id;
    });

    it("creates an activity linked to a Lead in the same company", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/activities")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          subject: "Introductory email sent",
          entityType: "lead",
          entityId: leadAId,
          type: "email",
        })
        .expect(201);

      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.entityType).toBe("lead");
      expect(res.body.data.entityId).toBe(leadAId);
    });

    it("rejects activity creation linked to a Customer in another company with 400 Bad Request", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/activities")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          subject: "Cross-tenant attack call",
          entityType: "contact",
          entityId: customerBId,
        })
        .expect(400);

      expect(res.body.message).toContain("Target contact does not exist or does not belong to your company");
    });

    it("rejects activity creation linked to a Lead in another company with 400 Bad Request", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/activities")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          subject: "Cross-tenant attack lead",
          entityType: "lead",
          entityId: leadBId,
        })
        .expect(400);

      expect(res.body.message).toContain("Target lead does not exist or does not belong to your company");
    });

    it("rejects activity creation linked to a nonexistent entity with 400 Bad Request", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/crm/activities")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          subject: "Nonexistent entity",
          entityType: "lead",
          entityId: "nonexistent-cuid-999",
        })
        .expect(400);
    });

    it("ignores forged companyId and forged userId in request body", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/activities")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          companyId: companyBId,
          userId: userBId,
          subject: "Spoof test",
          entityType: "contact",
          entityId: customerAId,
        })
        .expect(201);

      // Verify in DB that companyId is Company A and userId is User A
      const dbRecord = await prisma.crmActivity.findUnique({ where: { id: res.body.data.id } });
      expect(dbRecord!.companyId).toBe(companyAId);
      expect(dbRecord!.userId).toBe(userAId);
    });
  });

  describe("GET /api/v1/crm/activities — List & Filter Activities", () => {
    it("returns activities belonging to Company A for Company A user", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/crm/activities")
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      const ids = res.body.data.map((a: any) => a.id);
      expect(ids).toContain(activityA1Id);
    });

    it("never leaks Company A activities to Company B user (strict tenant isolation)", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/crm/activities")
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(200);

      const ids = res.body.data.map((a: any) => a.id);
      expect(ids).not.toContain(activityA1Id);
    });

    it("filters activities by entityType and entityId", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/crm/activities?entityType=contact&entityId=${customerAId}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      for (const act of res.body.data) {
        expect(act.entityType).toBe("contact");
        expect(act.entityId).toBe(customerAId);
      }
    });

    it("rejects filtering with entity belonging to another company with 400 Bad Request", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/crm/activities?entityType=contact&entityId=${customerBId}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(400);
    });
  });

  describe("GET /api/v1/crm/activities/:id — Get Single Activity", () => {
    it("returns activity for Company A user", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/crm/activities/${activityA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.data.id).toBe(activityA1Id);
      expect(res.body.data.subject).toBe("Initial discovery call");
    });

    it("returns 404 for Company B user attempting to access Company A activity", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/crm/activities/${activityA1Id}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(404);
    });
  });

  describe("PUT/PATCH /api/v1/crm/activities/:id — Update Activity", () => {
    it("updates activity subject and description for Company A user", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/crm/activities/${activityA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          subject: "Updated call notes",
          durationMinutes: 45,
        })
        .expect(200);

      expect(res.body.data.subject).toBe("Updated call notes");
      expect(res.body.data.durationMinutes).toBe(45);
    });

    it("rejects updating activity by Company B user with 404", async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/crm/activities/${activityA1Id}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .send({
          subject: "Hacked by Company B",
        })
        .expect(404);
    });

    it("rejects updating activity to point to another company's entity with 400", async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/crm/activities/${activityA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          entityType: "contact",
          entityId: customerBId,
        })
        .expect(400);
    });
  });

  describe("POST /api/v1/crm/activities/reassign — Reassign Activities on Lead Conversion", () => {
    it("reassigns activities from lead to contact within the same company", async () => {
      // Create activity on leadA
      const actRes = await request(app.getHttpServer())
        .post("/api/v1/crm/activities")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          subject: "Pre-conversion activity",
          entityType: "lead",
          entityId: leadAId,
        })
        .expect(201);

      const preActId = actRes.body.data.id;

      // Reassign to customerA
      const reassignRes = await request(app.getHttpServer())
        .post("/api/v1/crm/activities/reassign")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          fromType: "lead",
          fromId: leadAId,
          toType: "contact",
          toId: customerAId,
        })
        .expect(201);

      expect(reassignRes.body.data.updatedCount).toBeGreaterThanOrEqual(1);

      // Verify activity now points to contact
      const checkRes = await request(app.getHttpServer())
        .get(`/api/v1/crm/activities/${preActId}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(checkRes.body.data.entityType).toBe("contact");
      expect(checkRes.body.data.entityId).toBe(customerAId);
    });
  });

  describe("DELETE /api/v1/crm/activities/:id — Soft Delete & Permissions", () => {
    it("rejects DELETE from user without crm.delete permission with 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/crm/activities/${activityA1Id}`)
        .set("Authorization", `Bearer ${tokenEmp}`)
        .expect(403);

      const dbAct = await prisma.crmActivity.findUnique({ where: { id: activityA1Id } });
      expect(dbAct).not.toBeNull();
      expect(dbAct!.deletedAt).toBeNull();
    });

    it("allows DELETE from user with crm.delete permission with 200 OK and soft-deletes", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/crm/activities/${activityA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.data.removed).toBe(true);

      const dbAct = await prisma.crmActivity.findUnique({ where: { id: activityA1Id } });
      expect(dbAct!.deletedAt).not.toBeNull();

      // Verify GET returns 404
      await request(app.getHttpServer())
        .get(`/api/v1/crm/activities/${activityA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(404);
    });
  });
});
