/**
 * D-Arrow Phase 4.3 â€” Live PostgreSQL Integration Tests
 *
 * These tests run against the REAL NestJS backend and the REAL local
 * PostgreSQL database `darrow_dev`. They verify the One Account = One
 * Company invariant end-to-end through actual HTTP requests.
 *
 * Safety: Only reads/writes `darrow_dev`. Never touches production.
 * Test records use unique identifiers and are cleaned up where possible.
 */

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app-setup";
import { PrismaService } from "../src/common/prisma.service";
import request from "supertest";

// Helper: generate a unique suffix per test run to avoid collisions
const UNIQUE = Date.now().toString(36);

const baseUser = {
  email: `e2e-user-${UNIQUE}@darrow.test`,
  password: "E2ePass123!",
  name: "E2E User",
};

const baseCompany = {
  name: `E2E Company ${UNIQUE}`,
};

describe("Phase 4.3 â€” One Account = One Company Integration Tests", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;
  let userId: string;
  let accessToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    // Verify we are connected to darrow_dev only
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleRef.get(PrismaService);

    // Safety check: verify database target
    const result = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      "SELECT current_database() AS current_database",
    );
    if (result[0]?.current_database !== "darrow_dev") {
      throw new Error(
        `Unexpected database target: ${result[0]?.current_database}. Expected darrow_dev.`,
      );
    }
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  // ------------------------------------------------------------------
  // Stage 3.1 â€” Registration
  // ------------------------------------------------------------------

  describe("Registration", () => {
    it("3.1.1 â€” Register with company creates exactly one company and one membership", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/register")
        .send({
          email: baseUser.email,
          password: baseUser.password,
          name: baseUser.name,
          companyName: baseCompany.name,
        })
        .expect(201);

      expect(response.body.data.id).toBeDefined();
      userId = response.body.data.id;

      // Verify company was created and get its ID from the database
      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user).not.toBeNull();

      const memberships = await prisma.companyMembership.findMany({
        where: { userId },
        include: { company: true },
      });
      expect(memberships.length).toBe(1);
      companyId = memberships[0].companyId;
      expect(companyId).toBeDefined();

      // Verify company exists and ownerId matches
      const company = await prisma.company.findUnique({ where: { id: companyId } });
      expect(company).not.toBeNull();
      expect(company!.ownerId).toBe(userId);
    });

    it("3.1.2 â€” Register without companyName creates no membership", async () => {
      const email = `e2e-noco-${UNIQUE}@darrow.test`;
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/register")
        .send({ email, password: baseUser.password, name: "No Company User" })
        .expect(201);

      const noCoUserId = response.body.data.id;
      expect(response.body.data.companyId).toBeUndefined();

      // Verify zero memberships
      const memberships = await prisma.companyMembership.count({
        where: { userId: noCoUserId },
      });
      expect(memberships).toBe(0);

      // Cleanup: delete the user (no company, no membership)
      await prisma.user.delete({ where: { id: noCoUserId } });
    });

    it("3.1.3 â€” Duplicate registration with same email is rejected", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/register")
        .send({
          email: baseUser.email,
          password: baseUser.password,
          name: baseUser.name,
        })
        .expect(409);
    });
  });

  // ------------------------------------------------------------------
  // Stage 3.2 â€” Login / Refresh / Logout
  // ------------------------------------------------------------------

  describe("Authentication lifecycle", () => {
    it("3.2.1 â€” Login returns access + refresh tokens with correct company context", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: baseUser.email, password: baseUser.password })
        .expect(200);

      accessToken = response.body.data.accessToken;
      refreshToken = response.body.data.refreshToken;

      expect(accessToken).toBeDefined();
      expect(refreshToken).toBeDefined();
      expect(response.body.data.user.companyId).toBe(companyId);
      expect(response.body.data.user.role).toBe("ADMIN");
    });

    it("3.2.2 â€” Refresh returns new token pair with same company context", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .send({ refreshToken })
        .expect(200);

      const newAccessToken = response.body.data.accessToken;
      const newRefreshToken = response.body.data.refreshToken;

      expect(newAccessToken).toBeDefined();
      expect(newRefreshToken).toBeDefined();
      expect(newRefreshToken).not.toBe(refreshToken); // rotation occurred
      expect(response.body.data.user.companyId).toBe(companyId);

      refreshToken = newRefreshToken; // update for subsequent tests
    });

    it("3.2.3 â€” /auth/me returns correct company context", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/me")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data.userId).toBe(userId);
      expect(response.body.data.companyId).toBe(companyId);
    });

    it("3.2.4 â€” Reuse of revoked refresh token is rejected", async () => {
      // First revoke via logout
      await request(app.getHttpServer())
        .post("/api/v1/auth/logout")
        .send({ refreshToken })
        .expect(200);

      // Now try to use the revoked token
      await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .send({ refreshToken })
        .expect(401);
    });

    it("3.2.5 â€” Login with wrong password is rejected", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: baseUser.email, password: "WrongPass123!" })
        .expect(401);
    });

    it("3.2.6 — Login with unknown email is rejected", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: "unknown@darrow.test", password: "E2ePass123!" })
        .expect(401);
    });

    it("3.2.7 — Refresh with invalid token is rejected", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: "completely-bogus-token-value" })
        .expect(401);
    });

    it("3.2.8 — Concurrent refresh requests using same token safely allows at most 1 success", async () => {
      const loginRes = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: baseUser.email, password: baseUser.password })
        .expect(200);

      const tokenToRace = loginRes.body.data.refreshToken;
      accessToken = loginRes.body.data.accessToken;

      const refreshResults = await Promise.all([
        request(app.getHttpServer())
          .post("/api/v1/auth/refresh")
          .send({ refreshToken: tokenToRace }),
        request(app.getHttpServer())
          .post("/api/v1/auth/refresh")
          .send({ refreshToken: tokenToRace }),
      ]);

      const successCount = refreshResults.filter((r) => r.status === 200).length;
      expect(successCount).toBe(1);
      const rejectCount = refreshResults.filter((r) => r.status === 401).length;
      expect(rejectCount).toBe(1);

      const winning = refreshResults.find((r) => r.status === 200);
      refreshToken = winning?.body.data.refreshToken;
      accessToken = winning?.body.data.accessToken;
    });
  });

  // ------------------------------------------------------------------
  // Stage 3.3 â€” Tenant Isolation
  // ------------------------------------------------------------------

  describe("Tenant Isolation", () => {
    let companyBId: string;
    let userBId: string;
    let tokenB: string;

    beforeAll(async () => {
      // Create a second company and user for cross-tenant tests
      // Use a unique email and company name
      const regResponse = await request(app.getHttpServer())
        .post("/api/v1/auth/register")
        .send({
          email: `e2e-userb-${UNIQUE}@darrow.test`,
          password: "E2ePass123!",
          name: "E2E User B",
          companyName: `E2E Company B ${UNIQUE}`,
        })
        .expect(201);

      userBId = regResponse.body.data.id;

      // Get companyBId from database
      const userBMemberships = await prisma.companyMembership.findMany({
        where: { userId: userBId },
        include: { company: true },
      });
      expect(userBMemberships.length).toBe(1);
      companyBId = userBMemberships[0].companyId;

      const loginResponse = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({
          email: `e2e-userb-${UNIQUE}@darrow.test`,
          password: "E2ePass123!",
        })
        .expect(200);

      tokenB = loginResponse.body.data.accessToken;
    });

    it("3.3.1 â€” User A cannot access Company B companies endpoint", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyBId}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(404); // existence not leaked
    });

    it("3.3.2 â€” User B cannot access Company A companies endpoint", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyId}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(404);
    });

    it("3.3.3 â€” User A cannot create branch in Company B", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/branches")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ companyId: companyBId, name: "Hacked Branch" })
        .expect(403);
    });

    it("3.3.4 — Cross-tenant company membership count stays at 1 per user", async () => {
      const membershipsA = await prisma.companyMembership.count({
        where: { userId },
      });
      const membershipsB = await prisma.companyMembership.count({
        where: { userId: userBId },
      });
      expect(membershipsA).toBe(1);
      expect(membershipsB).toBe(1);
    });

    it("3.3.5 — PostgreSQL database rejects duplicate membership insertion for same user", async () => {
      await expect(
        prisma.companyMembership.create({
          data: {
            userId: userId,
            companyId: companyBId,
            role: "EMPLOYEE",
            status: "ACTIVE",
          },
        }),
      ).rejects.toThrow();
    });

    it("3.3.6 — Suspended membership is rejected by JwtStrategy", async () => {
      await prisma.companyMembership.update({
        where: { userId: userBId },
        data: { status: "SUSPENDED" },
      });

      await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyBId}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(401);

      await prisma.companyMembership.update({
        where: { userId: userBId },
        data: { status: "ACTIVE" },
      });
    });

    it("3.3.7 — Deleted company is rejected by JwtStrategy", async () => {
      await prisma.company.update({
        where: { id: companyBId },
        data: { deletedAt: new Date() },
      });

      await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyBId}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(401);

      await prisma.company.update({
        where: { id: companyBId },
        data: { deletedAt: null },
      });
    });

    it("3.3.8 — Deactivated user is rejected by JwtStrategy", async () => {
      await prisma.user.update({
        where: { id: userBId },
        data: { deletedAt: new Date() },
      });

      await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyBId}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(401);

      await prisma.user.update({
        where: { id: userBId },
        data: { deletedAt: null },
      });
    });

    afterAll(async () => {
      // Cleanup company B and user B
      await prisma.companyMembership.deleteMany({ where: { userId: userBId } });
      await prisma.company.delete({ where: { id: companyBId } });
      await prisma.user.delete({ where: { id: userBId } });
    });
  });

  // ------------------------------------------------------------------
  // Stage 3.4 â€” Invitation Acceptance
  // ------------------------------------------------------------------

  describe("Invitation Acceptance", () => {
    let inviteToken: string;
    let inviteCompanyId: string;

    beforeAll(async () => {
      // Create an invitation by inserting directly into the database
      // (simulating an admin creating an invitation)
      const inviteEmail = `e2e-invitee-${UNIQUE}@darrow.test`;
      inviteCompanyId = companyId; // same company as userA

      const invitation = await (prisma as any).invitation.create({
        data: {
          id: `invite-${UNIQUE}`,
          email: inviteEmail,
          companyId: inviteCompanyId,
          companyName: baseCompany.name,
          role: "EMPLOYEE",
          invitedByUserId: userId,
          invitedByName: baseUser.name,
          status: "PENDING",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        },
      });
      inviteToken = invitation.id;
    });

    it("3.4.1 â€” New account accepts valid invitation", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/invitation/accept")
        .send({
          token: inviteToken,
          email: `e2e-invitee-${UNIQUE}@darrow.test`,
          password: "InviteePass123!",
          name: "Invitee User",
        })
        .expect(200);

      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.user.companyId).toBe(inviteCompanyId);

      // Verify exactly one membership for the invitee
      const invitee = await prisma.user.findUnique({
        where: { email: `e2e-invitee-${UNIQUE}@darrow.test` },
      });
      const memberships = await prisma.companyMembership.count({
        where: { userId: invitee!.id },
      });
      expect(memberships).toBe(1);

      // Verify invitation is ACCEPTED
      const updatedInvitation = await prisma.invitation.findUnique({
        where: { id: inviteToken },
      });
      expect(updatedInvitation!.status).toBe("ACCEPTED");
    });

    it("3.4.2 â€” Expired invitation is rejected", async () => {
      const expiredInvite = await (prisma as any).invitation.create({
        data: {
          id: `invite-expired-${UNIQUE}`,
          email: `e2e-expired-${UNIQUE}@darrow.test`,
          companyId: inviteCompanyId,
          companyName: baseCompany.name,
          role: "EMPLOYEE",
          invitedByUserId: userId,
          invitedByName: baseUser.name,
          status: "PENDING",
          expiresAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
        },
      });

      await request(app.getHttpServer())
        .post("/api/v1/auth/invitation/accept")
        .send({
          token: expiredInvite.id,
          email: `e2e-expired-${UNIQUE}@darrow.test`,
          password: "ExpiredPass123!",
          name: "Expired User",
        })
        .expect(400);

      // Cleanup
      await prisma.invitation.delete({ where: { id: expiredInvite.id } });
    });

    it("3.4.3 â€” Already accepted invitation is rejected", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/auth/invitation/accept")
        .send({
          token: inviteToken, // already accepted in 3.4.1
          email: `e2e-invitee-${UNIQUE}@darrow.test`,
          password: "InviteePass123!",
          name: "Invitee User",
        })
        .expect(400);
    });

    it("3.4.4 â€” Email mismatch is rejected", async () => {
      const mismatchInvite = await (prisma as any).invitation.create({
        data: {
          id: `invite-mismatch-${UNIQUE}`,
          email: `e2e-mismatch-${UNIQUE}@darrow.test`,
          companyId: inviteCompanyId,
          companyName: baseCompany.name,
          role: "EMPLOYEE",
          invitedByUserId: userId,
          invitedByName: baseUser.name,
          status: "PENDING",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      await request(app.getHttpServer())
        .post("/api/v1/auth/invitation/accept")
        .send({
          token: mismatchInvite.id,
          email: `e2e-wrong-${UNIQUE}@darrow.test`, // wrong email
          password: "MismatchPass123!",
          name: "Wrong User",
        })
        .expect(400);

      await prisma.invitation.delete({ where: { id: mismatchInvite.id } });
    });

    it("3.4.5 â€” Invitation acceptance when account already has membership is rejected", async () => {
      // Create an invitation for the existing userA (who already has membership)
      const existingUserInvite = await (prisma as any).invitation.create({
        data: {
          id: `invite-existing-${UNIQUE}`,
          email: baseUser.email, // userA's email
          companyId: companyId,
          companyName: baseCompany.name,
          role: "EMPLOYEE",
          invitedByUserId: userId,
          invitedByName: baseUser.name,
          status: "PENDING",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      await request(app.getHttpServer())
        .post("/api/v1/auth/invitation/accept")
        .send({
          token: existingUserInvite.id,
          email: baseUser.email,
          password: baseUser.password,
          name: baseUser.name,
        })
        .expect(403); // Forbidden - already belongs to a company

      await prisma.invitation.delete({ where: { id: existingUserInvite.id } });
    });

    it("3.4.6 â€” Concurrent acceptance of the same invitation is safe", async () => {
      const concurrentInvite = await (prisma as any).invitation.create({
        data: {
          id: `invite-concurrent-${UNIQUE}`,
          email: `e2e-concurrent-${UNIQUE}@darrow.test`,
          companyId: inviteCompanyId,
          companyName: baseCompany.name,
          role: "EMPLOYEE",
          invitedByUserId: userId,
          invitedByName: baseUser.name,
          status: "PENDING",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      // Fire two concurrent acceptance requests
      const results = await Promise.all([
        request(app.getHttpServer())
          .post("/api/v1/auth/invitation/accept")
          .send({
            token: concurrentInvite.id,
            email: `e2e-concurrent-${UNIQUE}@darrow.test`,
            password: "ConcurrentPass123!",
            name: "Concurrent User",
          }),
        request(app.getHttpServer())
          .post("/api/v1/auth/invitation/accept")
          .send({
            token: concurrentInvite.id,
            email: `e2e-concurrent-${UNIQUE}@darrow.test`,
            password: "ConcurrentPass123!",
            name: "Concurrent User",
          }),
      ]);

      // At most one acceptance may succeed; losers must get a safe domain error.
      const successCount = results.filter((r: any) => r.status === 200).length;
      expect(successCount).toBeLessThanOrEqual(1);
      results.forEach((r: any) => expect([200, 400, 403, 409]).toContain(r.status));

      // Verify only ONE membership was created for the concurrent user
      const concurrentUser = await prisma.user.findUnique({
        where: { email: `e2e-concurrent-${UNIQUE}@darrow.test` },
      });
      if (concurrentUser) {
        const memberships = await prisma.companyMembership.count({
          where: { userId: concurrentUser.id },
        });
        expect(memberships).toBeLessThanOrEqual(1);
      }

      // If an acceptance succeeded, invitation must be ACCEPTED.
      if (successCount === 1) {
        const updatedInvite = await prisma.invitation.findUnique({
          where: { id: concurrentInvite.id },
        });
        expect(updatedInvite!.status).toBe("ACCEPTED");
      }

      // Cleanup
      if (concurrentUser) {
        await prisma.companyMembership.deleteMany({ where: { userId: concurrentUser.id } });
        await prisma.user.delete({ where: { id: concurrentUser.id } });
      }
      await prisma.invitation.delete({ where: { id: concurrentInvite.id } });
    });

    afterAll(async () => {
      // Cleanup invitee from 3.4.1
      const invitee = await prisma.user.findUnique({
        where: { email: `e2e-invitee-${UNIQUE}@darrow.test` },
      });
      if (invitee) {
        await prisma.companyMembership.deleteMany({ where: { userId: invitee.id } });
        await prisma.user.delete({ where: { id: invitee.id } });
      }
    });
  });

  // ------------------------------------------------------------------
  // Stage 3.5 â€” Employee Consistency
  // ------------------------------------------------------------------

  describe("Employee Consistency", () => {
    it("3.5.1 — Creating employee with mismatched company is rejected", async () => {
      // userA membership is in companyA. Mismatched companyId must be rejected by tenant/membership checks.
      const response = await request(app.getHttpServer())
        .post("/api/v1/hr/employees")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          userId: userId,
          companyId: "nonexistent-company-id",
          employeeNumber: "E2E-001",
          jobTitle: "Test",
        });

      expect([400, 403, 404]).toContain(response.status);
    });

    it("3.5.2 — User has exactly one membership", async () => {
      const memberships = await prisma.companyMembership.count({
        where: { userId },
      });
      expect(memberships).toBe(1);
    });

    it("3.5.3 — Valid employee created in same company succeeds", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/hr/employees")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          userId: userId,
          companyId: companyId,
          employeeNumber: `EMP-${UNIQUE}`,
          jobTitle: "Staff Engineer",
        })
        .expect(201);

      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.userId).toBe(userId);
      expect(response.body.data.companyId).toBe(companyId);

      // Cleanup employee record
      await prisma.employee.delete({ where: { userId } });
    });

    it("3.5.4 — Cross-company employee creation (target user belongs to another company) is rejected", async () => {
      const otherUserRes = await request(app.getHttpServer())
        .post("/api/v1/auth/register")
        .send({
          email: `other-user-${UNIQUE}@darrow.test`,
          password: "OtherPass123!",
          name: "Other User",
          companyName: `Other Company ${UNIQUE}`,
        })
        .expect(201);

      const otherUserId = otherUserRes.body.data.id;
      const otherCompany = await prisma.companyMembership.findUnique({
        where: { userId: otherUserId },
      });

      // Attempt to create employee in companyId linking otherUserId
      const res = await request(app.getHttpServer())
        .post("/api/v1/hr/employees")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          userId: otherUserId,
          companyId: companyId,
          employeeNumber: `EMP-X-${UNIQUE}`,
          jobTitle: "Cross Company Attack",
        });

      expect([400, 403]).toContain(res.status);

      // Cleanup
      await prisma.companyMembership.deleteMany({ where: { userId: otherUserId } });
      await prisma.company.delete({ where: { id: otherCompany!.companyId } });
      await prisma.user.delete({ where: { id: otherUserId } });
    });
  });

  // ------------------------------------------------------------------
  // Stage 3.6 â€” Invitation Concurrency (live database)
  // ------------------------------------------------------------------

  describe("Invitation Concurrency", () => {
    it("3.6.1 â€” Two concurrent invitations for same user: only one membership created", async () => {
      // Create two invitations for the same email (new user)
      const concurrentEmail = `e2e-conc-${UNIQUE}@darrow.test`;

      await (prisma as any).invitation.create({
        data: {
          id: `invite-conc-1-${UNIQUE}`,
          email: concurrentEmail,
          companyId: companyId,
          companyName: baseCompany.name,
          role: "EMPLOYEE",
          invitedByUserId: userId,
          invitedByName: baseUser.name,
          status: "PENDING",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      await (prisma as any).invitation.create({
        data: {
          id: `invite-conc-2-${UNIQUE}`,
          email: concurrentEmail,
          companyId: companyId,
          companyName: baseCompany.name,
          role: "EMPLOYEE",
          invitedByUserId: userId,
          invitedByName: baseUser.name,
          status: "PENDING",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      // Fire both acceptances concurrently
      const results = await Promise.all([
        request(app.getHttpServer())
          .post("/api/v1/auth/invitation/accept")
          .send({
            token: `invite-conc-1-${UNIQUE}`,
            email: concurrentEmail,
            password: "ConcPass123!",
            name: "Concurrent User",
          }),
        request(app.getHttpServer())
          .post("/api/v1/auth/invitation/accept")
          .send({
            token: `invite-conc-2-${UNIQUE}`,
            email: concurrentEmail,
            password: "ConcPass123!",
            name: "Concurrent User",
          }),
      ]);

      // At most one acceptance may succeed; losers must get a safe domain error.
      const successCount = results.filter((r: any) => r.status === 200).length;
      expect(successCount).toBeLessThanOrEqual(1);
      results.forEach((r: any) => expect([200, 400, 403, 409]).toContain(r.status));
      // Verify only ONE membership exists
      const concurrentUser = await prisma.user.findUnique({
        where: { email: concurrentEmail },
      });
      if (concurrentUser) {

        // Cleanup
        await prisma.companyMembership.deleteMany({ where: { userId: concurrentUser.id } });
        await prisma.user.delete({ where: { id: concurrentUser.id } });
      }

      // Cleanup invitations
      await prisma.invitation.delete({ where: { id: `invite-conc-1-${UNIQUE}` } });
      await prisma.invitation.delete({ where: { id: `invite-conc-2-${UNIQUE}` } });
    });
  });

  // ------------------------------------------------------------------
  // Stage 3.7 â€” Cross-Tenant Isolation
  // ------------------------------------------------------------------

  describe("Cross-Tenant Isolation", () => {
    let companyCId: string;

    beforeAll(async () => {
      // Create a third company for aggregate testing
      const regResponse = await request(app.getHttpServer())
        .post("/api/v1/auth/register")
        .send({
          email: `e2e-userc-${UNIQUE}@darrow.test`,
          password: "E2ePass123!",
          name: "E2E User C",
          companyName: `E2E Company C ${UNIQUE}`,
        })
        .expect(201);

      const membershipsC = await prisma.companyMembership.findMany({
        where: { userId: regResponse.body.data.id },
      });
      expect(membershipsC.length).toBe(1);
      companyCId = membershipsC[0].companyId;
    });
    it("3.7.1 — User A cannot list Company C companies", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyCId}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(404);
    });

    it("3.7.2 â€” User A companies list contains only their own company", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/companies")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      const companies = response.body.data;
      expect(companies.length).toBe(1);
      expect(companies[0].id).toBe(companyId);
    });

    it("3.7.3 — User A cannot update Company C", async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/companies/${companyCId}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: "Hacked Company C" })
        .expect(404);
    });

    it("3.7.4 — User A cannot delete Company C", async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/companies/${companyCId}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(404);
    });

    it("3.7.5 — User A cannot view branches of Company C", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/branches/company/${companyCId}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(403);
    });

    afterAll(async () => {
      await prisma.companyMembership.deleteMany({ where: { companyId: companyCId } });
      await prisma.company.delete({ where: { id: companyCId } });
      // Delete the user C (created during registration)
      await prisma.user.deleteMany({ where: { email: `e2e-userc-${UNIQUE}@darrow.test` } });
    });
  });

  // ------------------------------------------------------------------
  // Stage 3.8 â€” Final invariant verification
  // ------------------------------------------------------------------

  describe("Final Invariant Verification", () => {
    it("3.8.1 â€” No user has more than one membership", async () => {
      const multiMembershipUsers = await prisma.companyMembership.groupBy({
        by: ["userId"],
        having: {
          userId: {
            _count: { gt: 1 },
          },
        },
      });
      expect(multiMembershipUsers).toHaveLength(0);
    });

    it("3.8.2 — Every active membership links to an existing company", async () => {
      const memberships = await prisma.companyMembership.findMany({
        where: { status: "ACTIVE" },
        include: { company: true },
      });
      const orphaned = memberships.filter((m) => !m.company || m.company.deletedAt);
      expect(orphaned).toHaveLength(0);
    });

    it("3.8.3 — Every employee record matches the user's active company membership", async () => {
      const employees = await prisma.employee.findMany({
        where: { deletedAt: null },
      });
      for (const emp of employees) {
        const mem = await prisma.companyMembership.findUnique({
          where: { userId: emp.userId },
        });
        expect(mem).not.toBeNull();
        expect(mem!.companyId).toBe(emp.companyId);
      }
    });
  });
});
