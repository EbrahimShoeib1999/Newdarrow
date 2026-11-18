import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app-setup";
import { PrismaService } from "../src/common/prisma.service";

const UNIQUE = Date.now().toString(36);

describe("CRM Customers (e2e) — Tenant Isolation & CRUD", () => {
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

  let customerA1Id: string;

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

    // Register Company A + User A
    const emailA = `crm-test-a-${UNIQUE}@darrow.test`;
    const resA = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: emailA,
        password: "Password123!",
        name: "User A",
        companyName: `Company A ${UNIQUE}`,
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

    // Register Company B + User B
    const emailB = `crm-test-b-${UNIQUE}@darrow.test`;
    const resB = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: emailB,
        password: "Password123!",
        name: "User B",
        companyName: `Company B ${UNIQUE}`,
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
    const emailEmp = `crm-test-emp-${UNIQUE}@darrow.test`;
    const resEmp = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: emailEmp,
        password: "Password123!",
        name: "Employee A",
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
    // Clean up created entities safely
    if (prisma) {
      if (userEmpId) {
        await prisma.companyMembership.deleteMany({ where: { userId: userEmpId } });
        await prisma.refreshToken.deleteMany({ where: { userId: userEmpId } });
        await prisma.user.deleteMany({ where: { id: userEmpId } });
      }
      if (companyAId) {
        await prisma.customer.deleteMany({ where: { companyId: companyAId } });
        await prisma.companyMembership.deleteMany({ where: { companyId: companyAId } });
        await prisma.refreshToken.deleteMany({ where: { userId: userAId } });
        await prisma.company.deleteMany({ where: { id: companyAId } });
        await prisma.user.deleteMany({ where: { id: userAId } });
      }
      if (companyBId) {
        await prisma.customer.deleteMany({ where: { companyId: companyBId } });
        await prisma.companyMembership.deleteMany({ where: { companyId: companyBId } });
        await prisma.refreshToken.deleteMany({ where: { userId: userBId } });
        await prisma.company.deleteMany({ where: { id: companyBId } });
        await prisma.user.deleteMany({ where: { id: userBId } });
      }
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  describe("Authentication Guard", () => {
    it("rejects unauthenticated GET /api/v1/crm/customers with 401", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/crm/customers")
        .expect(401);
    });

    it("rejects unauthenticated POST /api/v1/crm/customers with 401", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/crm/customers")
        .send({ firstName: "Unauth" })
        .expect(401);
    });
  });

  describe("Customer CRUD & Response Envelope", () => {
    it("creates a customer in Company A with single response envelope", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/customers")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          firstName: "John",
          lastName: "Doe",
          email: "john.doe@test.com",
          phone: "+966551234567",
          entityType: "individual",
          city: "Riyadh",
        })
        .expect(201);

      expect(res.body).toHaveProperty("data");
      expect(res.body).toHaveProperty("message", "Customer created");
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.companyId).toBe(companyAId);
      expect(res.body.data.firstName).toBe("John");
      expect(res.body.data.lastName).toBe("Doe");
      expect(res.body.data.email).toBe("john.doe@test.com");
      expect(res.body.data.type).toBe("INDIVIDUAL");

      customerA1Id = res.body.data.id;
    });

    it("prevents client companyId tampering on creation", async () => {
      // User A attempts to create a customer under Company B's ID
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/customers")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          companyId: companyBId,
          firstName: "Tamper",
          lastName: "Attempt",
          email: "tamper@test.com",
        })
        .expect(201);

      // Customer is forced into User A's company (Company A), never Company B
      expect(res.body.data.companyId).toBe(companyAId);
      expect(res.body.data.companyId).not.toBe(companyBId);
    });

    it("retrieves the created customer for Company A", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/crm/customers/${customerA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.data.id).toBe(customerA1Id);
      expect(res.body.data.companyId).toBe(companyAId);
      expect(res.body.message).toBe("Customer retrieved");
    });

    it("updates the customer for Company A", async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/crm/customers/${customerA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          email: "john.updated@test.com",
          city: "Jeddah",
        })
        .expect(200);

      expect(res.body.data.id).toBe(customerA1Id);
      expect(res.body.data.email).toBe("john.updated@test.com");
      expect(res.body.data.city).toBe("Jeddah");
      expect(res.body.message).toBe("Customer updated");
    });
  });

  describe("Tenant Isolation Between Companies", () => {
    it("Company B user cannot view Company A customer list", async () => {
      const resB = await request(app.getHttpServer())
        .get("/api/v1/crm/customers")
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(200);

      expect(resB.body.data).toEqual([]);
      expect(resB.body.message).toBe("Customers listed");

      // Verify Company A sees its customers
      const resA = await request(app.getHttpServer())
        .get("/api/v1/crm/customers")
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      const ids = resA.body.data.map((c: any) => c.id);
      expect(ids).toContain(customerA1Id);
    });

    it("Company B user cannot retrieve Company A customer by ID (404)", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/crm/customers/${customerA1Id}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(404);
    });

    it("Company B user cannot update Company A customer (404)", async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/crm/customers/${customerA1Id}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .send({ firstName: "Hacked" })
        .expect(404);
    });

    it("Company B user cannot delete Company A customer (404)", async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/crm/customers/${customerA1Id}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(404);
    });
  });

  describe("Backend RBAC Authorization for Deletion", () => {
    it("rejects DELETE from authenticated employee without crm.delete permission with 403 Forbidden", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/crm/customers/${customerA1Id}`)
        .set("Authorization", `Bearer ${tokenEmp}`)
        .expect(403);

      expect(res.body.message).toContain("crm.delete");

      // Verify customer was NOT deleted and remains active in database
      const dbCustomer = await prisma.customer.findUnique({ where: { id: customerA1Id } });
      expect(dbCustomer).not.toBeNull();
      expect(dbCustomer!.deletedAt).toBeNull();
    });

    it("allows DELETE from authenticated admin with crm.delete permission with 200 OK and soft-deletes", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/crm/customers/${customerA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.data.removed).toBe(true);
      expect(res.body.message).toBe("Customer deleted");

      // Verify excluded from customer list
      const listRes = await request(app.getHttpServer())
        .get("/api/v1/crm/customers")
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      const ids = listRes.body.data.map((c: any) => c.id);
      expect(ids).not.toContain(customerA1Id);

      // Verify 404 when requested directly
      await request(app.getHttpServer())
        .get(`/api/v1/crm/customers/${customerA1Id}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(404);

      // Verify soft delete in database
      const dbCustomer = await prisma.customer.findUnique({ where: { id: customerA1Id } });
      expect(dbCustomer).not.toBeNull();
      expect(dbCustomer!.deletedAt).not.toBeNull();
    });
  });
});
