import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

export interface CreateClassificationDto {
  key?: string;
  nameAr: string;
  nameEn: string;
  color?: string;
  emoji?: string;
}

export interface UpdateClassificationDto {
  nameAr?: string;
  nameEn?: string;
  color?: string;
  emoji?: string;
  isActive?: boolean;
  isArchived?: boolean;
}

export const SYSTEM_DEFAULT_CLASSIFICATIONS = [
  {
    id: "default-actual-client",
    key: "actual_client",
    nameAr: "عميل فعلي",
    nameEn: "Actual Client",
    color: "success",
    emoji: "🟢",
    isDefault: true,
    isActive: true,
    isArchived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "default-potential-lead",
    key: "potential_lead",
    nameAr: "عميل محتمل",
    nameEn: "Potential Lead",
    color: "warning",
    emoji: "🟡",
    isDefault: true,
    isActive: true,
    isArchived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "default-callback",
    key: "callback",
    nameAr: "معاودة الاتصال",
    nameEn: "Callback",
    color: "primary",
    emoji: "🔵",
    isDefault: true,
    isActive: true,
    isArchived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

function mapClassificationToResponse(c: any) {
  return {
    id: c.id,
    key: c.key,
    nameAr: c.nameAr,
    nameEn: c.nameEn,
    color: c.color || "primary",
    emoji: c.emoji ?? undefined,
    isDefault: Boolean(c.isDefault),
    isActive: Boolean(c.isActive),
    isArchived: Boolean(c.isArchived),
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
    updatedAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : c.updatedAt,
  };
}

@Injectable()
export class ContactClassificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string) {
    const list = await this.prisma.crmContactClassification.findMany({
      where: { companyId, isArchived: false },
      orderBy: { createdAt: "asc" },
    });

    const mapped = list.map(mapClassificationToResponse);
    const existingKeys = new Set(mapped.map((c) => c.key));

    // Guarantee default classifications are always available
    const merged = [...mapped];
    for (const def of SYSTEM_DEFAULT_CLASSIFICATIONS) {
      if (!existingKeys.has(def.key)) {
        merged.push(def);
      }
    }

    return merged;
  }

  async findById(companyId: string, id: string) {
    const item = await this.prisma.crmContactClassification.findFirst({
      where: { id, companyId },
    });
    if (!item) {
      throw new NotFoundException(`Classification with ID ${id} not found`);
    }
    return mapClassificationToResponse(item);
  }

  async create(companyId: string, dto: CreateClassificationDto) {
    if (!dto.nameAr && !dto.nameEn) {
      throw new BadRequestException("nameAr or nameEn is required");
    }

    const rawKey = dto.key || dto.nameEn || dto.nameAr;
    const normalizedKey = rawKey
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, "_");

    const existing = await this.prisma.crmContactClassification.findUnique({
      where: {
        companyId_key: {
          companyId,
          key: normalizedKey,
        },
      },
    });

    if (existing) {
      if (existing.isArchived) {
        // Unarchive
        const unarchived = await this.prisma.crmContactClassification.update({
          where: { id: existing.id },
          data: {
            isArchived: false,
            nameAr: dto.nameAr || existing.nameAr,
            nameEn: dto.nameEn || existing.nameEn,
            color: dto.color || existing.color,
            emoji: dto.emoji || existing.emoji,
          },
        });
        return mapClassificationToResponse(unarchived);
      }
      throw new ConflictException(`Classification key '${normalizedKey}' already exists`);
    }

    const classification = await this.prisma.crmContactClassification.create({
      data: {
        companyId,
        key: normalizedKey,
        nameAr: dto.nameAr || dto.nameEn,
        nameEn: dto.nameEn || dto.nameAr,
        color: dto.color || "primary",
        emoji: dto.emoji || null,
        isDefault: false,
        isActive: true,
        isArchived: false,
      },
    });

    return mapClassificationToResponse(classification);
  }

  async update(companyId: string, id: string, dto: UpdateClassificationDto) {
    await this.findById(companyId, id);

    const updateData: any = {};
    if (dto.nameAr !== undefined) updateData.nameAr = dto.nameAr;
    if (dto.nameEn !== undefined) updateData.nameEn = dto.nameEn;
    if (dto.color !== undefined) updateData.color = dto.color;
    if (dto.emoji !== undefined) updateData.emoji = dto.emoji;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    if (dto.isArchived !== undefined) updateData.isArchived = dto.isArchived;

    const updated = await this.prisma.crmContactClassification.update({
      where: { id },
      data: updateData,
    });

    return mapClassificationToResponse(updated);
  }

  async remove(companyId: string, id: string) {
    // Check if it's one of the system default ids
    if (id.startsWith("default-")) {
      return; // Cannot delete virtual defaults
    }
    const item = await this.prisma.crmContactClassification.findFirst({
      where: { id, companyId },
    });
    if (!item) {
      return;
    }
    if (item.isDefault) {
      throw new BadRequestException("Cannot delete default classification");
    }
    await this.prisma.crmContactClassification.update({
      where: { id },
      data: { isArchived: true },
    });
  }
}
