import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app-setup";
import { PrismaService } from "../src/common/prisma.service";

const UNIQUE = Date.now().toString(36);

describe("CRM Notifications (e2e) — User Isolation & Operations", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let companyAId: string;
  let userA1Id: string;
  let tokenA1: string;

  let userA2Id: string;
  let tokenA2: string;

  let companyBId: string;
  let userBId: string;
  let tokenB: string;

  let notificationA2Id: string;

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

    // Register Company A + User A1
    const emailA1 = `crm-notif-a1-${UNIQUE}@darrow.test`;
    const resA1 = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: emailA1,
        password: "Password123!",
        name: "User Notif A1",
        companyName: `Company Notif A ${UNIQUE}`,
      })
      .expect(201);

    userA1Id = resA1.body.data.id;
    const membershipA = await prisma.companyMembership.findUnique({ where: { userId: userA1Id } });
    companyAId = membershipA!.companyId;

    const loginResA1 = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: emailA1, password: "Password123!" })
      .expect(200);
    tokenA1 = loginResA1.body.data.accessToken;

    // Register User A2 in Company A
    const emailA2 = `crm-notif-a2-${UNIQUE}@darrow.test`;
    const resA2 = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: emailA2,
        password: "Password123!",
        name: "User Notif A2",
      })
      .expect(201);

    userA2Id = resA2.body.data.id;
    await prisma.companyMembership.create({
      data: {
        userId: userA2Id,
        companyId: companyAId,
        role: "EMPLOYEE",
        status: "ACTIVE",
      },
    });

    const loginResA2 = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: emailA2, password: "Password123!" })
      .expect(200);
    tokenA2 = loginResA2.body.data.accessToken;

    // Register Company B + User B
    const emailB = `crm-notif-b-${UNIQUE}@darrow.test`;
    const resB = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: emailB,
        password: "Password123!",
        name: "User Notif B",
        companyName: `Company Notif B ${UNIQUE}`,
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
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe("POST /api/v1/crm/notifications — Creation & Target Validation", () => {
    it("creates a notification targeted to another user within the same company", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/notifications")
        .set("Authorization", `Bearer ${tokenA1}`)
        .send({
          userId: userA2Id,
          type: "assignment",
          title: "New Task Assigned",
          body: "Follow up with client",
          entityType: "crm_task",
          entityId: "task-123",
        })
        .expect(201);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.userId).toBe(userA2Id);
      expect(res.body.data.type).toBe("assignment");
      expect(res.body.data.title).toBe("New Task Assigned");
      expect(res.body.data.read).toBe(false);

      notificationA2Id = res.body.data.id;
    });

    it("rejects creating a notification targeted to a user in another company with 400 Bad Request", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/crm/notifications")
        .set("Authorization", `Bearer ${tokenA1}`)
        .send({
          userId: userBId,
          type: "general",
          title: "Cross-tenant spam",
          body: "Unauthorized message",
        })
        .expect(400);

      expect(res.body.message).toContain("Target user does not belong to your company");
    });

    it("rejects creating a notification for a nonexistent user with 400 Bad Request", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/crm/notifications")
        .set("Authorization", `Bearer ${tokenA1}`)
        .send({
          userId: "nonexistent-user-cuid",
          title: "Ghost user notification",
          body: "Cannot send",
        })
        .expect(400);
    });
  });

  describe("GET /api/v1/crm/notifications — Strict User Isolation (No Multi-User Leak)", () => {
    it("returns ONLY notifications belonging to the authenticated user", async () => {
      // User A2 lists notifications -> sees the notification created for A2
      const resA2 = await request(app.getHttpServer())
        .get("/api/v1/crm/notifications")
        .set("Authorization", `Bearer ${tokenA2}`)
        .expect(200);

      expect(Array.isArray(resA2.body.data)).toBe(true);
      const idsA2 = resA2.body.data.map((n: any) => n.id);
      expect(idsA2).toContain(notificationA2Id);

      // User A1 (same company, different user) lists notifications -> does NOT see A2's notification
      const resA1 = await request(app.getHttpServer())
        .get("/api/v1/crm/notifications")
        .set("Authorization", `Bearer ${tokenA1}`)
        .expect(200);

      const idsA1 = resA1.body.data.map((n: any) => n.id);
      expect(idsA1).not.toContain(notificationA2Id);

      // User B (different company) -> does NOT see A2's notification
      const resB = await request(app.getHttpServer())
        .get("/api/v1/crm/notifications")
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(200);

      const idsB = resB.body.data.map((n: any) => n.id);
      expect(idsB).not.toContain(notificationA2Id);
    });
  });

  describe("GET /api/v1/crm/notifications/unread-count — Unread Count", () => {
    it("returns correct unread count per user", async () => {
      const resA2 = await request(app.getHttpServer())
        .get("/api/v1/crm/notifications/unread-count")
        .set("Authorization", `Bearer ${tokenA2}`)
        .expect(200);

      expect(resA2.body.data.count).toBe(1);

      const resA1 = await request(app.getHttpServer())
        .get("/api/v1/crm/notifications/unread-count")
        .set("Authorization", `Bearer ${tokenA1}`)
        .expect(200);

      expect(resA1.body.data.count).toBe(0);
    });
  });

  describe("PATCH /api/v1/crm/notifications/:id/read — Mark Single as Read", () => {
    it("rejects marking read by a different user in the same company with 404", async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/crm/notifications/${notificationA2Id}/read`)
        .set("Authorization", `Bearer ${tokenA1}`)
        .expect(404);
    });

    it("rejects marking read by a user from another company with 404", async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/crm/notifications/${notificationA2Id}/read`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(404);
    });

    it("allows the owner user to mark the notification as read", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/crm/notifications/${notificationA2Id}/read`)
        .set("Authorization", `Bearer ${tokenA2}`)
        .expect(200);

      expect(res.body.data.read).toBe(true);

      // Verify unread count is now 0
      const countRes = await request(app.getHttpServer())
        .get("/api/v1/crm/notifications/unread-count")
        .set("Authorization", `Bearer ${tokenA2}`)
        .expect(200);

      expect(countRes.body.data.count).toBe(0);
    });
  });

  describe("POST /api/v1/crm/notifications/mark-all-read — Mark All Read", () => {
    it("marks all unread notifications read for the authenticated user", async () => {
      // Create two unread notifications for User A2
      await request(app.getHttpServer())
        .post("/api/v1/crm/notifications")
        .set("Authorization", `Bearer ${tokenA1}`)
        .send({
          userId: userA2Id,
          type: "deal_stage",
          title: "Deal stage updated 1",
          body: "Deal moved to Qualification",
        })
        .expect(201);

      await request(app.getHttpServer())
        .post("/api/v1/crm/notifications")
        .set("Authorization", `Bearer ${tokenA1}`)
        .send({
          userId: userA2Id,
          type: "deal_stage",
          title: "Deal stage updated 2",
          body: "Deal moved to Negotiation",
        })
        .expect(201);

      // Check unread count is 2
      const beforeCount = await request(app.getHttpServer())
        .get("/api/v1/crm/notifications/unread-count")
        .set("Authorization", `Bearer ${tokenA2}`)
        .expect(200);
      expect(beforeCount.body.data.count).toBe(2);

      // Call mark-all-read
      const markAllRes = await request(app.getHttpServer())
        .post("/api/v1/crm/notifications/mark-all-read")
        .set("Authorization", `Bearer ${tokenA2}`)
        .expect(201);

      expect(markAllRes.body.data.count).toBe(2);
      expect(markAllRes.body.data.success).toBe(true);

      // Check unread count is 0
      const afterCount = await request(app.getHttpServer())
        .get("/api/v1/crm/notifications/unread-count")
        .set("Authorization", `Bearer ${tokenA2}`)
        .expect(200);
      expect(afterCount.body.data.count).toBe(0);
    });
  });

  describe("DELETE /api/v1/crm/notifications/:id — Delete Notification", () => {
    it("rejects deletion by a different user with 404", async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/crm/notifications/${notificationA2Id}`)
        .set("Authorization", `Bearer ${tokenA1}`)
        .expect(404);
    });

    it("allows deletion by the recipient user", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/crm/notifications/${notificationA2Id}`)
        .set("Authorization", `Bearer ${tokenA2}`)
        .expect(200);

      expect(res.body.data.removed).toBe(true);

      const dbRecord = await prisma.crmNotification.findUnique({ where: { id: notificationA2Id } });
      expect(dbRecord).toBeNull();
    });
  });
});
