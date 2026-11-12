/**
 * D-Arrow Security Regression Tests — Phase 3
 *
 * Tenant isolation, IDOR, RBAC, auth security, and rate limiting tests.
 * Uses mocked PrismaService to avoid database dependency.
 */

import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";

// ---------------------------------------------------------------------------
// Mock PrismaService (jest.Mocked to preserve mockResolvedValue typing)
// ---------------------------------------------------------------------------

const mockPrisma: any = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  company: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  companyMembership: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
  },
  branch: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  employee: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  customer: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  lead: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  deal: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  invoice: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  invitation: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  rolePermission: {
    findMany: jest.fn(),
  },
  $connect: jest.fn(),
  $disconnect: jest.fn(),
};

jest.mock("../common/prisma.service", () => ({
  PrismaService: jest.fn().mockImplementation(() => mockPrisma),
}));

// ---------------------------------------------------------------------------
// Imports after mock
// ---------------------------------------------------------------------------
import { PrismaService } from "../common/prisma.service";
import { CompaniesService } from "../companies/companies.service";
import { BranchesService } from "../branches/branches.service";
import { EmployeesService } from "../hr/employees.service";
import { AttendanceService } from "../hr/attendance.service";
import { LeaveRequestsService } from "../hr/leave-requests.service";
import { CustomersService } from "../crm/customers.service";
import { LeadsService } from "../crm/leads.service";
import { DealsService } from "../crm/deals.service";
import { InvoicesService } from "../finance/invoices.service";
import { AuthService } from "../auth/auth.service";

const prisma: any = mockPrisma;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const companyA = { id: "company-a", name: "Company A", deletedAt: null };
const companyB = { id: "company-b", name: "Company B", deletedAt: null };

const membershipA = {
  id: "membership-a",
  userId: "user-a",
  companyId: "company-a",
  role: "ADMIN",
  status: "ACTIVE",
};

const userA = { id: "user-a", email: "a@companya.com", passwordHash: "hashed-password-a" };
const userB = { id: "user-b", email: "b@companyb.com", passwordHash: "hashed-password-b" };

const branchA = { id: "branch-a", companyId: "company-a", name: "Branch A", deletedAt: null };
const branchB = { id: "branch-b", companyId: "company-b", name: "Branch B", deletedAt: null };

const employeeA = { id: "employee-a", userId: "user-a", companyId: "company-a", employeeNumber: "E001", deletedAt: null };
const employeeB = { id: "employee-b", userId: "user-b", companyId: "company-b", employeeNumber: "E002", deletedAt: null };

const customerA = { id: "customer-a", companyId: "company-a", name: "Customer A", deletedAt: null };
const customerB = { id: "customer-b", companyId: "company-b", name: "Customer B", deletedAt: null };

const leadA = { id: "lead-a", companyId: "company-a", name: "Lead A", deletedAt: null };
const leadB = { id: "lead-b", companyId: "company-b", name: "Lead B", deletedAt: null };

const dealA = { id: "deal-a", companyId: "company-a", title: "Deal A", deletedAt: null };
const dealB = { id: "deal-b", companyId: "company-b", title: "Deal B", deletedAt: null };

const invoiceA = { id: "invoice-a", companyId: "company-a", invoiceNumber: "INV-001", deletedAt: null };
const invoiceB = { id: "invoice-b", companyId: "company-b", invoiceNumber: "INV-002", deletedAt: null };

// ---------------------------------------------------------------------------
// CompaniesService — Tenant Isolation
// ---------------------------------------------------------------------------

describe("CompaniesService — Tenant Isolation", () => {
  let service: CompaniesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CompaniesService(prisma as any);
  });

  it("findAll only returns the user's own company", async () => {
    prisma.company.findMany.mockResolvedValue([companyA]);

    const result = await service.findAll("company-a");

    expect(prisma.company.findMany).toHaveBeenCalledWith({
      where: { id: "company-a", deletedAt: null },
      include: { _count: { select: { branches: true, departments: true, memberships: true } } },
    });
    expect(result).toEqual([companyA]);
  });

  it("findOne rejects access to another company's record", async () => {
    prisma.company.findUnique.mockResolvedValue({ ...companyB, id: "company-b" });

    await expect(service.findOne("company-b", "company-a")).rejects.toThrow(NotFoundException);
  });

  it("update rejects modification of another company's record", async () => {
    prisma.company.findUnique.mockResolvedValue({ ...companyB, id: "company-b" });

    await expect(
      service.update("company-b", { name: "Hacked" } as any, "company-a"),
    ).rejects.toThrow(NotFoundException);
  });

  it("remove rejects deletion of another company's record", async () => {
    prisma.company.findUnique.mockResolvedValue({ ...companyB, id: "company-b" });

    await expect(service.remove("company-b", "company-a")).rejects.toThrow(NotFoundException);
  });

  it("create creates company and membership for the owner", async () => {
    prisma.company.create.mockResolvedValue(companyA);
    prisma.companyMembership.create.mockResolvedValue(membershipA);

    const result = await service.create({ name: "Test Co" } as any, "user-a");

    expect(prisma.company.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Test Co", ownerId: "user-a" }),
      }),
    );
    expect(prisma.companyMembership.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-a",
          companyId: companyA.id,
          role: "ADMIN",
          status: "ACTIVE",
        }),
      }),
    );
    expect(result).toEqual(companyA);
  });
});

// ---------------------------------------------------------------------------
// BranchesService — Tenant Isolation
// ---------------------------------------------------------------------------

describe("BranchesService — Tenant Isolation", () => {
  let service: BranchesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BranchesService(prisma as any);
  });

  it("create rejects branch creation in another company", async () => {
    await expect(
      service.create(
        { companyId: "company-b", name: "Hacked Branch" } as any,
        "company-a",
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("findOne rejects access to another company's branch", async () => {
    prisma.branch.findFirst.mockResolvedValue(branchB);

    await expect(service.findOne("branch-b", "company-a")).rejects.toThrow(NotFoundException);
  });

  it("update rejects modification of another company's branch", async () => {
    prisma.branch.findFirst.mockResolvedValue(branchB);

    await expect(
      service.update("branch-b", { name: "Hacked" } as any, "company-a"),
    ).rejects.toThrow(NotFoundException);
  });

  it("remove rejects deletion of another company's branch", async () => {
    prisma.branch.findFirst.mockResolvedValue(branchB);

    await expect(service.remove("branch-b", "company-a")).rejects.toThrow(NotFoundException);
  });

  it("findAll scopes to companyId", async () => {
    prisma.branch.findMany.mockResolvedValue([branchA]);

    const result = await service.findAll("company-a");

    expect(prisma.branch.findMany).toHaveBeenCalledWith({
      where: { companyId: "company-a", deletedAt: null },
    });
    expect(result).toEqual([branchA]);
  });
});

// ---------------------------------------------------------------------------
// EmployeesService — Tenant Isolation
// ---------------------------------------------------------------------------

describe("EmployeesService — Tenant Isolation", () => {
  let service: EmployeesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EmployeesService(prisma as any);
  });

  it("create rejects employee creation in another company", async () => {
    await expect(
      service.create(
        {
          userId: "user-b",
          companyId: "company-b",
          employeeNumber: "E002",
          jobTitle: "Hacker",
        } as any,
        "company-a",
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("findOne rejects access to another company's employee", async () => {
    prisma.employee.findFirst.mockResolvedValue(employeeB);

    await expect(service.findOne("employee-b", "company-a")).rejects.toThrow(NotFoundException);
  });

  it("update rejects modification of another company's employee", async () => {
    prisma.employee.findFirst.mockResolvedValue(employeeB);

    await expect(
      service.update("employee-b", { jobTitle: "Hacked" } as any, "company-a"),
    ).rejects.toThrow(NotFoundException);
  });

  it("remove rejects deletion of another company's employee", async () => {
    prisma.employee.findFirst.mockResolvedValue(employeeB);

    await expect(service.remove("employee-b", "company-a")).rejects.toThrow(NotFoundException);
  });

  it("findAll scopes to companyId", async () => {
    prisma.employee.findMany.mockResolvedValue([employeeA]);

    const result = await service.findAll("company-a");

    expect(prisma.employee.findMany).toHaveBeenCalledWith({
      where: { companyId: "company-a", deletedAt: null },
      include: { user: true, company: true, branch: true, department: true },
    });
    expect(result).toEqual([employeeA]);
  });
});

// ---------------------------------------------------------------------------
// CustomersService — Tenant Isolation (CRM)
// ---------------------------------------------------------------------------

describe("CustomersService — Tenant Isolation", () => {
  let service: CustomersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CustomersService(prisma as any);
  });

  it("create rejects customer creation in another company", async () => {
    await expect(
      service.create(
        { companyId: "company-b", firstName: "Hacked", lastName: "Customer" } as any,
        "company-a",
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("findOne rejects access to another company's customer", async () => {
    prisma.customer.findFirst.mockResolvedValue(customerB);

    await expect(service.findOne("customer-b", "company-a")).rejects.toThrow(NotFoundException);
  });

  it("update rejects modification of another company's customer", async () => {
    prisma.customer.findFirst.mockResolvedValue(customerB);

    await expect(
      service.update("customer-b", { firstName: "Hacked" } as any, "company-a"),
    ).rejects.toThrow(NotFoundException);
  });

  it("remove rejects deletion of another company's customer", async () => {
    prisma.customer.findFirst.mockResolvedValue(customerB);

    await expect(service.remove("customer-b", "company-a")).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// LeadsService — Tenant Isolation (CRM)
// ---------------------------------------------------------------------------

describe("LeadsService — Tenant Isolation", () => {
  let service: LeadsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LeadsService(prisma as any);
  });

  it("findOne rejects access to another company's lead", async () => {
    prisma.lead.findFirst.mockResolvedValue(leadB);

    await expect(service.findOne("lead-b", "company-a")).rejects.toThrow(NotFoundException);
  });

  it("update rejects modification of another company's lead", async () => {
    prisma.lead.findFirst.mockResolvedValue(leadB);

    await expect(
      service.update("lead-b", { name: "Hacked" } as any, "company-a"),
    ).rejects.toThrow(NotFoundException);
  });

  it("remove rejects deletion of another company's lead", async () => {
    prisma.lead.findFirst.mockResolvedValue(leadB);

    await expect(service.remove("lead-b", "company-a")).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// DealsService — Tenant Isolation (CRM)
// ---------------------------------------------------------------------------

describe("DealsService — Tenant Isolation", () => {
  let service: DealsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DealsService(prisma as any);
  });

  it("findOne rejects access to another company's deal", async () => {
    prisma.deal.findFirst.mockResolvedValue(dealB);

    await expect(service.findOne("deal-b", "company-a")).rejects.toThrow(NotFoundException);
  });

  it("update rejects modification of another company's deal", async () => {
    prisma.deal.findFirst.mockResolvedValue(dealB);

    await expect(
      service.update("deal-b", { title: "Hacked" } as any, "company-a"),
    ).rejects.toThrow(NotFoundException);
  });

  it("remove rejects deletion of another company's deal", async () => {
    prisma.deal.findFirst.mockResolvedValue(dealB);

    await expect(service.remove("deal-b", "company-a")).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// InvoicesService — Tenant Isolation (Finance)
// ---------------------------------------------------------------------------

describe("InvoicesService — Tenant Isolation", () => {
  let service: InvoicesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InvoicesService(prisma as any);
  });

  it("create rejects invoice creation in another company", async () => {
    await expect(
      service.create(
        { companyId: "company-b", invoiceNumber: "INV-HACKED", grandTotal: 100 } as any,
        [],
        "company-a",
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("findOne rejects access to another company's invoice", async () => {
    prisma.invoice.findFirst.mockResolvedValue(invoiceB);

    await expect(service.findOne("invoice-b", "company-a")).rejects.toThrow(NotFoundException);
  });

  it("update rejects modification of another company's invoice", async () => {
    prisma.invoice.findFirst.mockResolvedValue(invoiceB);

    await expect(
      service.update("invoice-b", { grandTotal: 999999 } as any, "company-a"),
    ).rejects.toThrow(NotFoundException);
  });

  it("remove rejects deletion of another company's invoice", async () => {
    prisma.invoice.findFirst.mockResolvedValue(invoiceB);

    await expect(service.remove("invoice-b", "company-a")).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// AuthService — JWT / Membership Model
// ---------------------------------------------------------------------------

describe("AuthService — JWT / Membership Model", () => {
  let service: AuthService;
  let mockJwtService: { sign: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockJwtService = { sign: jest.fn().mockReturnValue("mock-token") };
    service = new AuthService(prisma as any, mockJwtService as any);
  });

  it("generateTokens returns role from membership, not user.role", async () => {
    prisma.companyMembership.findFirst.mockResolvedValue({
      ...membershipA,
      role: "ADMIN",
      company: companyA,
    });

    const result = await (service as any).generateTokens(userA);

    expect(mockJwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({ role: "ADMIN", companyId: "company-a" }),
    );
    expect(result.user.role).toBe("ADMIN");
    expect(result.user.role).not.toBeUndefined();
  });

  it("generateTokens returns undefined role when no active membership", async () => {
    prisma.companyMembership.findFirst.mockResolvedValue(null);

    const result = await (service as any).generateTokens(userA);

    expect(result.user.role).toBeUndefined();
    expect(result.user.companyId).toBeUndefined();
  });

  it("register hashes password with bcrypt (cost 12)", async () => {
    jest.spyOn(bcrypt, "hash").mockResolvedValue("hashed-password" as never);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(userA);

    await service.register({
      email: "new@test.com",
      password: "Password123!",
      name: "New User",
    } as any);

    expect(bcrypt.hash).toHaveBeenCalledWith("Password123!", 12);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ passwordHash: "hashed-password" }),
      }),
    );
  });

  it("register rejects duplicate email", async () => {
    prisma.user.findUnique.mockResolvedValue(userA);

    await expect(
      service.register({
        email: "a@companya.com",
        password: "Password123!",
        name: "User",
      } as any),
    ).rejects.toThrow(ConflictException);
  });

  it("login rejects invalid credentials", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.login({ email: "unknown@test.com", password: "password" }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("login rejects wrong password", async () => {
    jest.spyOn(bcrypt, "compare").mockResolvedValue(false as never);
    prisma.user.findUnique.mockResolvedValue(userA);

    await expect(
      service.login({ email: "a@companya.com", password: "wrong-password" }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("refresh rejects expired token", async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      token: "expired-token",
      expiresAt: new Date(Date.now() - 10000),
      user: userA,
    });

    await expect(service.refresh("expired-token")).rejects.toThrow(UnauthorizedException);
  });

  it("refresh rejects invalid token", async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(null);

    await expect(service.refresh("invalid-token")).rejects.toThrow(UnauthorizedException);
  });

  it("refresh rotates tokens (deletes old, creates new)", async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      token: "old-token",
      expiresAt: new Date(Date.now() + 100000),
      user: userA,
    });
    prisma.companyMembership.findFirst.mockResolvedValue({
      ...membershipA,
      role: "ADMIN",
      company: companyA,
    });

    await service.refresh("old-token");

    expect(prisma.refreshToken.delete).toHaveBeenCalledTimes(1);
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it("logout deletes refresh token", async () => {
    prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

    await service.logout("some-token");

    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { token: "some-token" },
    });
  });

  it("acceptInvitation validates token exists", async () => {
    prisma.invitation.findUnique.mockResolvedValue(null);

    await expect(
      service.acceptInvitation({
        token: "invalid-token",
        email: "a@test.com",
        password: "Password123!",
        name: "Test",
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it("acceptInvitation validates invitation is pending", async () => {
    prisma.invitation.findUnique.mockResolvedValue({
      id: "token-1",
      status: "ACCEPTED",
      expiresAt: new Date(Date.now() + 100000),
      email: "a@test.com",
      companyId: "company-a",
      company: companyA,
      role: "EMPLOYEE",
      invitedByUserId: "user-a",
    });

    await expect(
      service.acceptInvitation({
        token: "token-1",
        email: "a@test.com",
        password: "Password123!",
        name: "Test",
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it("acceptInvitation validates email match", async () => {
    prisma.invitation.findUnique.mockResolvedValue({
      id: "token-1",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 100000),
      email: "other@test.com",
      companyId: "company-a",
      company: companyA,
      role: "EMPLOYEE",
      invitedByUserId: "user-a",
    });

    await expect(
      service.acceptInvitation({
        token: "token-1",
        email: "a@test.com",
        password: "Password123!",
        name: "Test",
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it("acceptInvitation creates user, membership, and marks accepted", async () => {
    prisma.invitation.findUnique.mockResolvedValue({
      id: "token-1",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 100000),
      email: "new@test.com",
      companyId: "company-a",
      company: companyA,
      role: "EMPLOYEE",
      invitedByUserId: "user-a",
    });
    prisma.user.findUnique.mockResolvedValue(null);
    jest.spyOn(bcrypt, "hash").mockResolvedValue("hashed" as never);
    prisma.user.create.mockResolvedValue({ ...userA, id: "new-user" });
    prisma.companyMembership.create.mockResolvedValue(membershipA);
    prisma.invitation.update.mockResolvedValue({});

    const result = await service.acceptInvitation({
      token: "token-1",
      email: "new@test.com",
      password: "Password123!",
      name: "New User",
    } as any);

    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(prisma.companyMembership.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "new-user",
          companyId: "company-a",
          role: "EMPLOYEE",
          status: "ACTIVE",
        }),
      }),
    );
    expect(prisma.invitation.update).toHaveBeenCalledWith({
      where: { id: "token-1" },
      data: expect.objectContaining({ status: "ACCEPTED" }),
    });
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AttendanceService — Tenant Isolation
// ---------------------------------------------------------------------------

describe("AttendanceService — Tenant Isolation", () => {
  let service: AttendanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AttendanceService(prisma as any);
  });

  it("create rejects attendance for another company's employee", async () => {
    await expect(
      service.create(
        { employeeId: "employee-b", companyId: "company-b" } as any,
        "company-a",
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("findOne rejects access to another company's attendance record", async () => {
    prisma.attendance.findFirst.mockResolvedValue({
      id: "attendance-b",
      companyId: "company-b",
    });

    await expect(service.findOne("attendance-b", "company-a")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("update rejects modification of another company's attendance record", async () => {
    prisma.attendance.findFirst.mockResolvedValue({
      id: "attendance-b",
      companyId: "company-b",
    });

    await expect(
      service.update("attendance-b", { status: "absent" } as any, "company-a"),
    ).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// LeaveRequestsService — Tenant Isolation
// ---------------------------------------------------------------------------

describe("LeaveRequestsService — Tenant Isolation", () => {
  let service: LeaveRequestsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LeaveRequestsService(prisma as any);
  });

  it("create rejects leave request for another company's employee", async () => {
    await expect(
      service.create(
        {
          employeeId: "employee-b",
          companyId: "company-b",
          type: "ANNUAL",
          reason: "Vacation",
        } as any,
        "company-a",
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("findOne rejects access to another company's leave request", async () => {
    prisma.leaveRequest.findFirst.mockResolvedValue({
      id: "leave-b",
      companyId: "company-b",
    });

    await expect(service.findOne("leave-b", "company-a")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("update rejects modification of another company's leave request", async () => {
    prisma.leaveRequest.findFirst.mockResolvedValue({
      id: "leave-b",
      companyId: "company-b",
    });

    await expect(
      service.update("leave-b", { status: "APPROVED" } as any, "user-a", "company-a"),
    ).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// Rate Limiting Configuration
// ---------------------------------------------------------------------------

describe("Rate Limiting Configuration", () => {
  it("env provides rate limit defaults", () => {
    const { parseEnv } = require("../config/env");
    const env = parseEnv({});
    expect(env.RATE_LIMIT_MAX).toBe(10);
    expect(env.RATE_LIMIT_WINDOW_SECONDS).toBe(60);
  });
});
