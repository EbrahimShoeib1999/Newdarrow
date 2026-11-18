import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { StorageService } from "../storage/storage.service";
import { validateUploadedFile } from "./utils/file-validation";

export interface CreateAttachmentDto {
  entityType: string;
  entityId: string;
  fileName: string;
  fileUrl: string;
  mimeType?: string;
  sizeBytes?: number;
  storageKey?: string;
  uploadedBy?: string;
}

export interface UpdateAttachmentDto {
  fileName?: string;
  fileUrl?: string;
  mimeType?: string;
  sizeBytes?: number;
  storageKey?: string;
}

export interface AttachmentContentResult {
  type: "stream" | "buffer";
  stream?: NodeJS.ReadableStream;
  buffer?: Buffer;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

function mapAttachmentToResponse(a: any) {
  return {
    id: a.id,
    entityType: a.entityType,
    entityId: a.entityId,
    fileName: a.fileName,
    fileUrl: a.fileUrl,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    uploadedBy: a.uploadedBy,
    createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
  };
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService
  ) {}

  private async validateEntityBelongsToCompany(
    companyId: string,
    entityType: string,
    entityId: string
  ): Promise<void> {
    const normType = entityType.toLowerCase();
    if (normType === "contact" || normType === "customer") {
      const exists = await this.prisma.customer.findFirst({
        where: { id: entityId, companyId, deletedAt: null },
      });
      if (!exists) throw new NotFoundException(`Customer/Contact not found in company`);
    } else if (normType === "lead") {
      const exists = await this.prisma.lead.findFirst({
        where: { id: entityId, companyId, deletedAt: null },
      });
      if (!exists) throw new NotFoundException(`Lead not found in company`);
    } else if (normType === "deal") {
      const exists = await this.prisma.deal.findFirst({
        where: { id: entityId, companyId, deletedAt: null },
      });
      if (!exists) throw new NotFoundException(`Deal not found in company`);
    } else if (normType === "contract") {
      const exists = await this.prisma.crmContract.findFirst({
        where: { id: entityId, companyId, deletedAt: null },
      });
      if (!exists) throw new NotFoundException(`Contract not found in company`);
    }
  }

  async findAll(
    companyId: string,
    filters?: { entityType?: string; entityId?: string; uploadedBy?: string }
  ) {
    const where: any = { companyId, deletedAt: null };
    if (filters?.entityType) where.entityType = filters.entityType;
    if (filters?.entityId) where.entityId = filters.entityId;
    if (filters?.uploadedBy) where.uploadedBy = filters.uploadedBy;

    const attachments = await this.prisma.crmAttachment.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return attachments.map(mapAttachmentToResponse);
  }

  async findById(companyId: string, id: string) {
    const attachment = await this.prisma.crmAttachment.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!attachment) {
      throw new NotFoundException(`Attachment with ID ${id} not found`);
    }
    return mapAttachmentToResponse(attachment);
  }

  async uploadAttachment(
    companyId: string,
    userId: string,
    entityType: string,
    entityId: string,
    file: Express.Multer.File
  ) {
    if (!entityType || !entityId) {
      throw new BadRequestException("entityType and entityId are required");
    }
    if (!file || !file.buffer) {
      throw new BadRequestException("No file uploaded");
    }

    // 1. Validate entity belongs to company
    await this.validateEntityBelongsToCompany(companyId, entityType, entityId);

    // 2. Validate file size, magic bytes and format
    const valResult = validateUploadedFile(file);
    if (!valResult.valid) {
      throw new BadRequestException(valResult.error || "Invalid file");
    }

    // 3. Generate storage key and save binary
    const storageKey = this.storageService.generateKey(
      companyId,
      entityType,
      entityId,
      valResult.sanitizedName
    );

    await this.storageService.saveFile(storageKey, file.buffer, valResult.mimeType);

    // 4. Create database record with rollback on failure
    let attachment;
    try {
      attachment = await this.prisma.crmAttachment.create({
        data: {
          companyId,
          entityType,
          entityId,
          fileName: valResult.sanitizedName,
          fileUrl: `/crm/attachments/temp/content`,
          mimeType: valResult.mimeType,
          sizeBytes: file.size,
          storageKey,
          uploadedBy: userId,
        },
      });

      // Update fileUrl to reference the specific attachment ID
      attachment = await this.prisma.crmAttachment.update({
        where: { id: attachment.id },
        data: { fileUrl: `/api/v1/crm/attachments/${attachment.id}/content` },
      });
    } catch (dbErr) {
      // Clean up orphaned binary file if database write fails
      await this.storageService.deleteFile(storageKey);
      throw dbErr;
    }

    // 5. Create activity log
    try {
      await this.prisma.crmActivity.create({
        data: {
          companyId,
          type: "NOTE" as any,
          subject: "File uploaded",
          description: valResult.sanitizedName,
          entityType,
          entityId,
          userId,
          occurredAt: new Date(),
        },
      });
    } catch {
      // Activity log failure should not fail attachment upload
    }

    return mapAttachmentToResponse(attachment);
  }

  async getAttachmentContent(companyId: string, id: string): Promise<AttachmentContentResult> {
    const attachment = await this.prisma.crmAttachment.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!attachment) {
      throw new NotFoundException(`Attachment with ID ${id} not found`);
    }

    // Handle persistent local storage files
    if (attachment.storageKey) {
      const exists = await this.storageService.fileExists(attachment.storageKey);
      if (!exists) {
        throw new NotFoundException("File binary not found in storage");
      }
      const stream = await this.storageService.getFileStream(attachment.storageKey);
      return {
        type: "stream",
        stream,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
      };
    }

    // Handle legacy base64 data URLs
    if (attachment.fileUrl && attachment.fileUrl.startsWith("data:")) {
      const match = attachment.fileUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const mimeType = match[1] || attachment.mimeType;
        const buffer = Buffer.from(match[2], "base64");
        return {
          type: "buffer",
          buffer,
          fileName: attachment.fileName,
          mimeType,
          sizeBytes: buffer.length,
        };
      }
    }

    throw new NotFoundException("Attachment content is not available locally");
  }

  async create(companyId: string, userId: string, dto: CreateAttachmentDto) {
    if (!dto.entityType || !dto.entityId || !dto.fileName || !dto.fileUrl) {
      throw new BadRequestException("entityType, entityId, fileName, and fileUrl are required");
    }

    const attachment = await this.prisma.crmAttachment.create({
      data: {
        companyId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        fileName: dto.fileName,
        fileUrl: dto.fileUrl,
        mimeType: dto.mimeType || "application/octet-stream",
        sizeBytes: typeof dto.sizeBytes === "number" ? Math.round(dto.sizeBytes) : 0,
        storageKey: dto.storageKey || null,
        uploadedBy: dto.uploadedBy || userId,
      },
    });

    return mapAttachmentToResponse(attachment);
  }

  async update(companyId: string, id: string, dto: UpdateAttachmentDto) {
    await this.findById(companyId, id);

    const updateData: any = {};
    if (dto.fileName !== undefined) updateData.fileName = dto.fileName;
    if (dto.fileUrl !== undefined) updateData.fileUrl = dto.fileUrl;
    if (dto.mimeType !== undefined) updateData.mimeType = dto.mimeType;
    if (dto.sizeBytes !== undefined) updateData.sizeBytes = Math.round(dto.sizeBytes);
    if (dto.storageKey !== undefined) updateData.storageKey = dto.storageKey;

    const updated = await this.prisma.crmAttachment.update({
      where: { id },
      data: updateData,
    });

    return mapAttachmentToResponse(updated);
  }

  async remove(companyId: string, id: string) {
    const attachment = await this.prisma.crmAttachment.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!attachment) {
      throw new NotFoundException(`Attachment with ID ${id} not found`);
    }

    // Clean up physical file on disk if storageKey exists
    if (attachment.storageKey) {
      await this.storageService.deleteFile(attachment.storageKey);
    }

    await this.prisma.crmAttachment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
