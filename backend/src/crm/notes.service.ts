import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

export interface CreateNoteDto {
  content: string;
  entityType: string;
  entityId: string;
  authorId?: string;
}

export interface UpdateNoteDto {
  content?: string;
  entityType?: string;
  entityId?: string;
}

function mapNoteToResponse(n: any) {
  return {
    id: n.id,
    content: n.content,
    entityType: n.entityType,
    entityId: n.entityId,
    authorId: n.authorId,
    createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : n.createdAt,
    updatedAt: n.updatedAt instanceof Date ? n.updatedAt.toISOString() : n.updatedAt,
  };
}

@Injectable()
export class NotesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    companyId: string,
    filters?: { entityType?: string; entityId?: string; authorId?: string }
  ) {
    const where: any = { companyId, deletedAt: null };
    if (filters?.entityType) where.entityType = filters.entityType;
    if (filters?.entityId) where.entityId = filters.entityId;
    if (filters?.authorId) where.authorId = filters.authorId;

    const notes = await this.prisma.crmNote.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return notes.map(mapNoteToResponse);
  }

  async findById(companyId: string, id: string) {
    const note = await this.prisma.crmNote.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!note) {
      throw new NotFoundException(`Note with ID ${id} not found`);
    }
    return mapNoteToResponse(note);
  }

  async create(companyId: string, userId: string, dto: CreateNoteDto) {
    if (!dto.content || !dto.entityType || !dto.entityId) {
      throw new BadRequestException("content, entityType, and entityId are required");
    }

    const note = await this.prisma.crmNote.create({
      data: {
        companyId,
        content: dto.content,
        entityType: dto.entityType,
        entityId: dto.entityId,
        authorId: dto.authorId || userId,
      },
    });

    return mapNoteToResponse(note);
  }

  async update(companyId: string, id: string, dto: UpdateNoteDto) {
    await this.findById(companyId, id);

    const updateData: any = {};
    if (dto.content !== undefined) updateData.content = dto.content;
    if (dto.entityType !== undefined) updateData.entityType = dto.entityType;
    if (dto.entityId !== undefined) updateData.entityId = dto.entityId;

    const updated = await this.prisma.crmNote.update({
      where: { id },
      data: updateData,
    });

    return mapNoteToResponse(updated);
  }

  async remove(companyId: string, id: string) {
    await this.findById(companyId, id);
    await this.prisma.crmNote.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
