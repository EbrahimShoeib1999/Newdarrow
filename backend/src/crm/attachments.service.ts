import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

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
  constructor(private readonly prisma: PrismaService) {}

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
    await this.findById(companyId, id);
    await this.prisma.crmAttachment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
