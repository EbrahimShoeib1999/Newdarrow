import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app-setup";
import { PrismaService } from "../src/common/prisma.service";

const UNIQUE = Date.now().toString(36);

describe("CRM Leads (e2e) — Tenant Isolation & CRUD", () => {
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

  let leadA1Id: string;

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
    const emailA = `crm-leads-a-${UNIQUE}@darrow.test`;
    const resA = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: emailA,
        password: "Password123!",
        name: "User Leads A",
        companyName: `Company Leads A ${UNIQUE}`,
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

    // Register Company B + User B (Owner/Admin)
    const emailB = `crm-leads-b-${UNIQUE}@darrow.test`;
    const resB = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: emailB,
        password: "Password123!",
        name: "User Leads B",
        companyName: `Company Leads B ${UNIQUE}`,
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

    // Register Employee in Company A (does not have crm.delete)
    const emailEmp = `crm-leads-emp-${UNIQUE}@darrow.test`;
    const resEmp = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: emailEmp,
        password: "Password123!",
        name: "Employee A (No Delete)",
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
        await prisma.companyMembership.deleteMany({ where: { userId: userBId } });
        await prisma.refreshToken.deleteMany({ where: { userId: userBId } });
        await prisma.user.deleteMany({ where: { id: userBId } });
        await prisma.company.deleteMany({ where: { id: companyBId } });
      }
      if (userAId) {
        await prisma.lead.deleteMany({ where: { companyId: companyAId } });
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
    it("rejects unauthenticated GET /api/v1/crm/leads with 401", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/crm/leads")
        .expect(401);
    });

    it("rejects unauthenticated POST /api/v1/crm/leads with 401", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/crm/leads")
        .send({ name: "Unauth Lead" })
        .expect(401);
    });

    it("rejects unauthenticated GET /api/v1/crm/leads/:id with 401", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/crm/leads/dummy-id")
        .expect(401);
    });

    it("rejects unauthenticated PUT /api/v1/crm/leads/:id with 401", async () => {
      await request(app.getHttpServer())
        .put("/api/v1/crm/leads/dummy-id")
        .send({ name: "Updated" })
        .expect(401);
    });

    it("rejects unauthenticated DELETE /api/v1/crm/leads/:id with 401", async () => {
      await request(app.getHttpServer())
        .delete("/api/v1/crm/leads/dummy-id")
        .expect(401);
    });
  });

  describe("Lead CRUD & Response Envelope", () => {
    it("creates a lead in Company A with single response envelope", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/leads")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          name: "Acme Corporation Prospect",
          companyName: "Acme Corp",
          email: "prospect@acmecorp.com",
          phone: "+966551122334",
          status: "new",
          source: "website",
          priority: "high",
          notes: "Initial inquiry from contact form",
        })
        .expect(201);

      expect(res.body).toHaveProperty("data");
      expect(res.body).toHaveProperty("message", "Lead created");
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.companyId).toBe(companyAId);
      expect(res.body.data.name).toBe("Acme Corporation Prospect");
      expect(res.body.data.companyName).toBe("Acme Corp");
      expect(res.body.data.email).toBe("prospect@acmecorp.com");
      expect(res.body.data.status).toBe("NEW");
      expect(res.body.data.source).toBe("website");
      expect(res.body.data.priority).toBe("high");

      leadA1Id = res.body.data.id;
    });

    it("prevents client companyId tampering on creation", async () => {
      // User A attempts to create a lead under Company B's ID
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/leads")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          companyId: companyBId,
          name: "Tamper Attempt Lead",
          email: "tamper@test.com",
        })
        .expect(201);

      // Lead is forced into User A's company (Company A), never Company B
      expect(res.body.data.companyId).toBe(companyAId);
      expect(res.body.data.companyId).not.toBe(companyBId);
    });

    it("retrieves the created lead for Company A", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/crm/leads/${leadA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.data.id).toBe(leadA1Id);
      expect(res.body.data.companyId).toBe(companyAId);
      expect(res.body.data.name).toBe("Acme Corporation Prospect");
      expect(res.body.message).toBe("Lead retrieved");
    });

    it("updates the lead for Company A", async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/crm/leads/${leadA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          companyName: "Acme Global Solutions",
          status: "proposal_sent",
          notes: "Sent proposal via email",
        })
        .expect(200);

      expect(res.body.data.id).toBe(leadA1Id);
      expect(res.body.data.companyName).toBe("Acme Global Solutions");
      expect(res.body.data.status).toBe("PROPOSAL");
      expect(res.body.data.notes).toBe("Sent proposal via email");
      expect(res.body.message).toBe("Lead updated");
    });
  });

  describe("Tenant Isolation Between Companies", () => {
    it("Company B user cannot view Company A leads list", async () => {
      const resB = await request(app.getHttpServer())
        .get("/api/v1/crm/leads")
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(200);

      expect(resB.body.data).toEqual([]);
      expect(resB.body.message).toBe("Leads listed");

      // Verify Company A sees its leads
      const resA = await request(app.getHttpServer())
        .get("/api/v1/crm/leads")
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      const ids = resA.body.data.map((l: any) => l.id);
      expect(ids).toContain(leadA1Id);
    });

    it("Company B user cannot retrieve Company A lead by ID (404)", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/crm/leads/${leadA1Id}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(404);
    });

    it("Company B user cannot update Company A lead (404)", async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/crm/leads/${leadA1Id}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .send({ name: "Hacked Lead" })
        .expect(404);
    });

    it("Company B user cannot delete Company A lead (404)", async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/crm/leads/${leadA1Id}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(404);
    });
  });

  describe("Backend RBAC Authorization for Deletion", () => {
    it("rejects DELETE from authenticated employee without crm.delete permission with 403 Forbidden", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/crm/leads/${leadA1Id}`)
        .set("Authorization", `Bearer ${tokenEmp}`)
        .expect(403);

      expect(res.body.message).toContain("crm.delete");

      // Verify lead was NOT deleted and remains active in database
      const dbLead = await prisma.lead.findUnique({ where: { id: leadA1Id } });
      expect(dbLead).not.toBeNull();
      expect(dbLead!.deletedAt).toBeNull();
    });

    it("allows DELETE from authenticated admin with crm.delete permission with 200 OK and soft-deletes", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/crm/leads/${leadA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.data.removed).toBe(true);
      expect(res.body.message).toBe("Lead deleted");

      // Verify excluded from lead list
      const listRes = await request(app.getHttpServer())
        .get("/api/v1/crm/leads")
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      const ids = listRes.body.data.map((l: any) => l.id);
      expect(ids).not.toContain(leadA1Id);

      // Verify 404 when requested directly
      await request(app.getHttpServer())
        .get(`/api/v1/crm/leads/${leadA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(404);

      // Verify soft delete in database
      const dbLead = await prisma.lead.findUnique({ where: { id: leadA1Id } });
      expect(dbLead).not.toBeNull();
      expect(dbLead!.deletedAt).not.toBeNull();
    });
  });
});
