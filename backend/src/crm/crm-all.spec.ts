import { ContractsService } from "./contracts.service";
import { QuotationsService } from "./quotations.service";
import { CrmTasksService } from "./crm-tasks.service";
import { NotesService } from "./notes.service";
import { AttachmentsService } from "./attachments.service";
import { ClientReportsService } from "./client-reports.service";
import { ContactClassificationsService } from "./contact-classifications.service";

describe("CRM Services (WP-05 through WP-12) Unit & Tenant Isolation Tests", () => {
  const companyA = "company-aaa-111";
  const companyB = "company-bbb-222";
  const userA = "user-aaa-111";

  // Mock Prisma Service
  const mockPrisma: any = {
    customer: {
      findFirst: jest.fn().mockResolvedValue({ id: "c-1", companyId: companyA }),
    },
    deal: {
      findFirst: jest.fn().mockResolvedValue({ id: "d-1", companyId: companyA }),
    },
    crmContract: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    crmQuotation: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    crmTask: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    crmNote: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    crmAttachment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    crmClientReport: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    crmContactClassification: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("WP-05: ContractsService", () => {
    it("should query contracts with strict companyId and deletedAt: null", async () => {
      const service = new ContractsService(mockPrisma);
      mockPrisma.crmContract.findMany.mockResolvedValue([]);

      await service.findAll(companyA);

      expect(mockPrisma.crmContract.findMany).toHaveBeenCalledWith({
        where: { companyId: companyA, deletedAt: null },
        orderBy: { createdAt: "desc" },
      });
    });

    it("should create contract with proper companyId scoping", async () => {
      const service = new ContractsService(mockPrisma);
      const mockCreated = {
        id: "contract-1",
        companyId: companyA,
        title: "Test Contract",
        form: { preamble: "terms" },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.crmContract.create.mockResolvedValue(mockCreated);

      const res = await service.create(
        {
          title: "Test Contract",
          form: { preamble: "terms" },
        },
        companyA,
        userA
      );

      expect(mockPrisma.crmContract.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: companyA,
          title: "Test Contract",
          createdBy: userA,
        }),
      });
      expect(res.id).toBe("contract-1");
    });
  });

  describe("WP-06: QuotationsService", () => {
    it("should enforce tenant scoping on quotation retrieval", async () => {
      const service = new QuotationsService(mockPrisma);
      mockPrisma.crmQuotation.findFirst.mockResolvedValue(null);

      await expect(service.findOne("quot-unknown", companyA)).rejects.toThrow();
      expect(mockPrisma.crmQuotation.findFirst).toHaveBeenCalledWith({
        where: { id: "quot-unknown", companyId: companyA, deletedAt: null },
      });
    });
  });

  describe("WP-07: CrmTasksService", () => {
    it("should soft-delete task by setting deletedAt", async () => {
      const service = new CrmTasksService(mockPrisma);
      mockPrisma.crmTask.findFirst.mockResolvedValue({ id: "task-1", companyId: companyA });
      mockPrisma.crmTask.update.mockResolvedValue({ id: "task-1", deletedAt: new Date() });

      await service.remove("task-1", companyA);

      expect(mockPrisma.crmTask.update).toHaveBeenCalledWith({
        where: { id: "task-1" },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });

  describe("WP-08: NotesService", () => {
    it("should fail creating note without required fields", async () => {
      const service = new NotesService(mockPrisma);
      await expect(service.create(companyA, userA, {} as any)).rejects.toThrow();
    });

    it("should create note scoped to companyId and author", async () => {
      const service = new NotesService(mockPrisma);
      mockPrisma.crmNote.create.mockResolvedValue({
        id: "note-1",
        companyId: companyA,
        content: "Call summary",
        entityType: "lead",
        entityId: "lead-1",
        authorId: userA,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await service.create(companyA, userA, {
        content: "Call summary",
        entityType: "lead",
        entityId: "lead-1",
      });

      expect(res.content).toBe("Call summary");
      expect(mockPrisma.crmNote.create).toHaveBeenCalledWith({
        data: {
          companyId: companyA,
          content: "Call summary",
          entityType: "lead",
          entityId: "lead-1",
          authorId: userA,
        },
      });
    });
  });

  describe("WP-09: AttachmentsService", () => {
    it("should filter attachments by entityType and entityId", async () => {
      const service = new AttachmentsService(mockPrisma);
      mockPrisma.crmAttachment.findMany.mockResolvedValue([]);

      await service.findAll(companyA, { entityType: "contact", entityId: "cust-1" });

      expect(mockPrisma.crmAttachment.findMany).toHaveBeenCalledWith({
        where: {
          companyId: companyA,
          deletedAt: null,
          entityType: "contact",
          entityId: "cust-1",
        },
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("WP-10 & WP-12: ClientReportsService & Public Access", () => {
    it("should sanitize internal notes on public view", async () => {
      const service = new ClientReportsService(mockPrisma);
      const mockReport = {
        id: "rep-1",
        companyId: companyA,
        contactId: "c-1",
        contactName: "Client A",
        authorId: userA,
        authorName: "Agent",
        title: "Report Title",
        content: "Public content body",
        internalNotes: "CONFIDENTIAL INTERNAL NOTE",
        reportType: "general",
        clientMood: "satisfied",
        satisfactionRating: 5,
        status: "submitted",
        isPublicRevoked: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.crmClientReport.findFirst.mockResolvedValue(mockReport);

      const publicRes = await service.findPublicReportById(companyA, "rep-1");

      expect(publicRes.title).toBe("Report Title");
      expect(publicRes.content).toBe("Public content body");
      expect((publicRes as any).internalNotes).toBeUndefined();
    });

    it("should reject public report if revoked", async () => {
      const service = new ClientReportsService(mockPrisma);
      mockPrisma.crmClientReport.findFirst.mockResolvedValue({
        id: "rep-1",
        companyId: companyA,
        isPublicRevoked: true,
      });

      await expect(service.findPublicReportById(companyA, "rep-1")).rejects.toThrow(
        "Public access to this report has been revoked"
      );
    });
  });

  describe("WP-11: ContactClassificationsService", () => {
    it("should merge custom classifications with default classifications", async () => {
      const service = new ContactClassificationsService(mockPrisma);
      mockPrisma.crmContactClassification.findMany.mockResolvedValue([
        {
          id: "custom-vip",
          key: "vip_client",
          nameAr: "عميل VIP",
          nameEn: "VIP Client",
          color: "warning",
          isDefault: false,
          isActive: true,
          isArchived: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const res = await service.findAll(companyA);

      expect(res.some((c) => c.key === "vip_client")).toBe(true);
      expect(res.some((c) => c.key === "actual_client")).toBe(true);
      expect(res.some((c) => c.key === "potential_lead")).toBe(true);
      expect(res.some((c) => c.key === "callback")).toBe(true);
    });
  });
});
