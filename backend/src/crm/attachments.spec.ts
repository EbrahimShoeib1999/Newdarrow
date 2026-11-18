import { Test, TestingModule } from "@nestjs/testing";
import { AttachmentsService } from "./attachments.service";
import { PrismaService } from "../common/prisma.service";
import { StorageService } from "../storage/storage.service";
import { LocalStorageAdapter } from "../storage/local-storage.adapter";
import { STORAGE_ADAPTER } from "../storage/storage.interface";
import { validateUploadedFile, sanitizeFilename } from "./utils/file-validation";
import * as path from "path";
import * as fs from "fs";

describe("CRM Storage & Attachments Architecture", () => {
  describe("File Validation & Magic Bytes", () => {
    it("sanitizes filenames against traversal and special characters", () => {
      const sanitized = sanitizeFilename("../../evil_name?*:.pdf");
      expect(sanitized).not.toContain("..");
      expect(sanitized).not.toContain("/");
      expect(sanitized).not.toContain("\\");
      expect(sanitized).toContain(".pdf");
    });

    it("rejects files exceeding 10 MB limit", () => {
      const oversizedBuffer = Buffer.alloc(11 * 1024 * 1024);
      const res = validateUploadedFile({
        originalname: "large.pdf",
        size: oversizedBuffer.length,
        buffer: oversizedBuffer,
      });
      expect(res.valid).toBe(false);
      expect(res.error).toContain("10 MB limit");
    });

    it("validates authentic PDF magic bytes (%PDF-)", () => {
      const pdfBuffer = Buffer.concat([Buffer.from("%PDF-1.4\n..."), Buffer.alloc(100)]);
      const res = validateUploadedFile({
        originalname: "report.pdf",
        size: pdfBuffer.length,
        buffer: pdfBuffer,
      });
      expect(res.valid).toBe(true);
      expect(res.mimeType).toBe("application/pdf");
    });

    it("rejects spoofed PDF with fake extension", () => {
      const fakePdfBuffer = Buffer.from("NOT_A_REAL_PDF_HEADER");
      const res = validateUploadedFile({
        originalname: "evil.pdf",
        size: fakePdfBuffer.length,
        buffer: fakePdfBuffer,
      });
      expect(res.valid).toBe(false);
      expect(res.error).toContain("does not match a valid PDF");
    });

    it("validates authentic PNG magic bytes", () => {
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const pngBuffer = Buffer.concat([pngHeader, Buffer.alloc(50)]);
      const res = validateUploadedFile({
        originalname: "image.png",
        size: pngBuffer.length,
        buffer: pngBuffer,
      });
      expect(res.valid).toBe(true);
      expect(res.mimeType).toBe("image/png");
    });

    it("rejects executable or unsupported file types", () => {
      const exeBuffer = Buffer.from("MZ\x90\x00...");
      const res = validateUploadedFile({
        originalname: "program.exe",
        size: exeBuffer.length,
        buffer: exeBuffer,
      });
      expect(res.valid).toBe(false);
      expect(res.error).toContain("not supported");
    });
  });

  describe("LocalStorageAdapter Path Security", () => {
    let adapter: LocalStorageAdapter;

    beforeEach(() => {
      adapter = new LocalStorageAdapter();
    });

    it("prevents directory traversal attempts", async () => {
      await expect(
        adapter.saveFile("../../../etc/passwd", Buffer.from("hack"))
      ).rejects.toThrow("Invalid storage path traversal");
    });

    it("saves and retrieves files within storage root", async () => {
      const key = `crm/test-company/contact/cust-1/test-${Date.now()}.pdf`;
      const content = Buffer.concat([Buffer.from("%PDF-1.5 test"), Buffer.alloc(50)]);

      const saved = await adapter.saveFile(key, content, "application/pdf");
      expect(saved.key).toBe(key);
      expect(saved.sizeBytes).toBe(content.length);

      const exists = await adapter.fileExists(key);
      expect(exists).toBe(true);

      const retrieved = await adapter.getFileBuffer(key);
      expect(retrieved.equals(content)).toBe(true);

      await adapter.deleteFile(key);
      const existsAfterDelete = await adapter.fileExists(key);
      expect(existsAfterDelete).toBe(false);
    });
  });

  describe("AttachmentsService Isolation & Lifecycle", () => {
    let service: AttachmentsService;
    let mockPrisma: any;
    let mockStorage: any;

    beforeEach(async () => {
      mockPrisma = {
        customer: { findFirst: jest.fn() },
        lead: { findFirst: jest.fn() },
        deal: { findFirst: jest.fn() },
        crmContract: { findFirst: jest.fn() },
        crmAttachment: {
          create: jest.fn(),
          update: jest.fn(),
          findFirst: jest.fn(),
          findMany: jest.fn(),
        },
        crmActivity: { create: jest.fn() },
      };

      mockStorage = {
        generateKey: jest.fn().mockReturnValue("crm/comp-1/contact/c-1/uuid.pdf"),
        saveFile: jest.fn().mockResolvedValue({ key: "k", sizeBytes: 100 }),
        getFileBuffer: jest.fn(),
        getFileStream: jest.fn().mockResolvedValue({ pipe: jest.fn() }),
        deleteFile: jest.fn().mockResolvedValue(undefined),
        fileExists: jest.fn().mockResolvedValue(true),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AttachmentsService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: StorageService, useValue: mockStorage },
        ],
      }).compile();

      service = module.get<AttachmentsService>(AttachmentsService);
    });

    it("rejects upload if entity does not belong to company", async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      const fakePdf = {
        originalname: "test.pdf",
        buffer: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(20)]),
        size: 30,
        mimetype: "application/pdf",
      } as any;

      await expect(
        service.uploadAttachment("comp-1", "user-1", "contact", "foreign-entity", fakePdf)
      ).rejects.toThrow("Customer/Contact not found in company");
    });

    it("cleans up binary file if database record creation fails", async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({ id: "cust-1", companyId: "comp-1" });
      mockPrisma.crmAttachment.create.mockRejectedValue(new Error("DB constraint error"));

      const validPdf = {
        originalname: "valid.pdf",
        buffer: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(20)]),
        size: 30,
        mimetype: "application/pdf",
      } as any;

      await expect(
        service.uploadAttachment("comp-1", "user-1", "contact", "cust-1", validPdf)
      ).rejects.toThrow("DB constraint error");

      expect(mockStorage.deleteFile).toHaveBeenCalledWith("crm/comp-1/contact/c-1/uuid.pdf");
    });

    it("serves legacy base64 data URLs via getAttachmentContent", async () => {
      const dataUrl = "data:application/pdf;base64," + Buffer.from("%PDF-1.4 legacy").toString("base64");
      mockPrisma.crmAttachment.findFirst.mockResolvedValue({
        id: "att-legacy",
        companyId: "comp-1",
        storageKey: null,
        fileUrl: dataUrl,
        fileName: "legacy.pdf",
        mimeType: "application/pdf",
        sizeBytes: 15,
      });

      const content = await service.getAttachmentContent("comp-1", "att-legacy");
      expect(content.type).toBe("buffer");
      expect(content.buffer).toBeDefined();
      expect(content.buffer!.toString()).toContain("%PDF-1.4 legacy");
    });
  });
});
