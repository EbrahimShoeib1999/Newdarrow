import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { CrmActivityType } from "@prisma/client";

export class CreateActivityDto {
  type?: string;
  subject!: string;
  description?: string;
  entityType!: string;
  entityId!: string;
  occurredAt?: string | Date;
  durationMinutes?: number;
  userId?: string;
  companyId?: string;
}

export class UpdateActivityDto {
  type?: string;
  subject?: string;
  description?: string;
  entityType?: string;
  entityId?: string;
  occurredAt?: string | Date;
  durationMinutes?: number;
}

export function mapActivityTypeToPrisma(type?: string | null): CrmActivityType {
  if (!type) return CrmActivityType.NOTE;
  const t = type.trim().toUpperCase();
  switch (t) {
    case "CALL":
      return CrmActivityType.CALL;
    case "EMAIL":
      return CrmActivityType.EMAIL;
    case "MEETING":
      return CrmActivityType.MEETING;
    case "NOTE":
      return CrmActivityType.NOTE;
    case "OTHER":
      return CrmActivityType.OTHER;
    default:
      if (Object.values(CrmActivityType).includes(type as CrmActivityType)) {
        return type as CrmActivityType;
      }
      return CrmActivityType.NOTE;
  }
}

function mapActivityToResponse(act: any) {
  return {
    id: act.id,
    type: act.type ? act.type.toLowerCase() : "note",
    subject: act.subject,
    description: act.description ?? undefined,
    entityType: act.entityType,
    entityId: act.entityId,
    occurredAt: act.occurredAt instanceof Date ? act.occurredAt.toISOString() : act.occurredAt,
    durationMinutes: act.durationMinutes ?? undefined,
    userId: act.userId,
    user: act.user
      ? {
          id: act.user.id,
          name: act.user.name,
          email: act.user.email,
        }
      : undefined,
    createdAt: act.createdAt instanceof Date ? act.createdAt.toISOString() : act.createdAt,
    updatedAt: act.updatedAt instanceof Date ? act.updatedAt.toISOString() : act.updatedAt,
  };
}

@Injectable()
export class ActivitiesService {
  constructor(private readonly prisma: PrismaService) {}

  private async validateTargetEntity(companyId: string, entityType: string, entityId: string) {
    const normType = entityType.trim().toLowerCase();
    if (normType === "contact" || normType === "customer") {
      const contact = await this.prisma.customer.findFirst({
        where: { id: entityId, companyId, deletedAt: null },
      });
      if (!contact) {
        throw new BadRequestException("Target contact does not exist or does not belong to your company");
      }
    } else if (normType === "lead") {
      const lead = await this.prisma.lead.findFirst({
        where: { id: entityId, companyId, deletedAt: null },
      });
      if (!lead) {
        throw new BadRequestException("Target lead does not exist or does not belong to your company");
      }
    } else if (normType === "deal") {
      const deal = await this.prisma.deal.findFirst({
        where: { id: entityId, companyId, deletedAt: null },
      });
      if (!deal) {
        throw new BadRequestException("Target deal does not exist or does not belong to your company");
      }
    } else {
      throw new BadRequestException(`Unsupported entity type: ${entityType}`);
    }
  }

  async findAll(companyId: string, filter?: { entityType?: string; entityId?: string }) {
    if (filter?.entityType && filter?.entityId) {
      await this.validateTargetEntity(companyId, filter.entityType, filter.entityId);
    }

    const where: any = {
      companyId,
      deletedAt: null,
    };

    if (filter?.entityType) {
      where.entityType = filter.entityType.toLowerCase();
    }
    if (filter?.entityId) {
      where.entityId = filter.entityId;
    }

    const activities = await this.prisma.crmActivity.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return activities.map(mapActivityToResponse);
  }

  async findOne(id: string, companyId: string) {
    const act = await this.prisma.crmActivity.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!act) {
      throw new NotFoundException("Activity not found");
    }

    return mapActivityToResponse(act);
  }

  async create(data: CreateActivityDto, companyId: string, userId: string) {
    if (!data.subject || typeof data.subject !== "string" || !data.subject.trim()) {
      throw new BadRequestException("Activity subject is required");
    }
    if (!data.entityType || typeof data.entityType !== "string") {
      throw new BadRequestException("entityType is required");
    }
    if (!data.entityId || typeof data.entityId !== "string") {
      throw new BadRequestException("entityId is required");
    }

    const normEntityType = data.entityType.trim().toLowerCase();
    await this.validateTargetEntity(companyId, normEntityType, data.entityId);

    let occurredAt: Date = new Date();
    if (data.occurredAt) {
      const parsed = new Date(data.occurredAt);
      if (!isNaN(parsed.getTime())) {
        occurredAt = parsed;
      }
    }

    const type = mapActivityTypeToPrisma(data.type);

    const created = await this.prisma.crmActivity.create({
      data: {
        companyId,
        userId,
        type,
        subject: data.subject.trim(),
        description: data.description?.trim() || null,
        entityType: normEntityType,
        entityId: data.entityId,
        occurredAt,
        durationMinutes: data.durationMinutes !== undefined && data.durationMinutes !== null ? Number(data.durationMinutes) : null,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return mapActivityToResponse(created);
  }

  async update(id: string, data: UpdateActivityDto, companyId: string) {
    const existing = await this.prisma.crmActivity.findFirst({
      where: { id, companyId, deletedAt: null },
    });

    if (!existing) {
      throw new NotFoundException("Activity not found");
    }

    const targetEntityType = data.entityType ? data.entityType.trim().toLowerCase() : existing.entityType;
    const targetEntityId = data.entityId ?? existing.entityId;

    if (data.entityType || data.entityId) {
      await this.validateTargetEntity(companyId, targetEntityType, targetEntityId);
    }

    const updateData: any = {};
    if (data.subject !== undefined) updateData.subject = data.subject.trim();
    if (data.description !== undefined) updateData.description = data.description?.trim() || null;
    if (data.type !== undefined) updateData.type = mapActivityTypeToPrisma(data.type);
    if (data.entityType !== undefined) updateData.entityType = targetEntityType;
    if (data.entityId !== undefined) updateData.entityId = targetEntityId;
    if (data.durationMinutes !== undefined) {
      updateData.durationMinutes = data.durationMinutes !== null ? Number(data.durationMinutes) : null;
    }
    if (data.occurredAt !== undefined) {
      if (data.occurredAt) {
        const parsed = new Date(data.occurredAt);
        if (!isNaN(parsed.getTime())) {
          updateData.occurredAt = parsed;
        }
      }
    }

    const updated = await this.prisma.crmActivity.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return mapActivityToResponse(updated);
  }

  async remove(id: string, companyId: string) {
    const existing = await this.prisma.crmActivity.findFirst({
      where: { id, companyId, deletedAt: null },
    });

    if (!existing) {
      throw new NotFoundException("Activity not found");
    }

    await this.prisma.crmActivity.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { removed: true };
  }

  async reassignEntityActivities(
    companyId: string,
    fromType: string,
    fromId: string,
    toType: string,
    toId: string
  ) {
    await this.validateTargetEntity(companyId, toType, toId);

    const result = await this.prisma.crmActivity.updateMany({
      where: {
        companyId,
        entityType: fromType.toLowerCase(),
        entityId: fromId,
        deletedAt: null,
      },
      data: {
        entityType: toType.toLowerCase(),
        entityId: toId,
      },
    });

    return { updatedCount: result.count };
  }
}
