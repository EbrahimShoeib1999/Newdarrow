import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { CrmNotificationType } from "@prisma/client";

export class CreateNotificationDto {
  userId!: string;
  type?: string;
  title!: string;
  body!: string;
  entityType?: string;
  entityId?: string;
  read?: boolean;
}

export function mapNotificationTypeToPrisma(type?: string | null): CrmNotificationType {
  if (!type) return CrmNotificationType.GENERAL;
  const t = type.trim().toUpperCase();
  switch (t) {
    case "ASSIGNMENT":
      return CrmNotificationType.ASSIGNMENT;
    case "DEAL_STAGE":
      return CrmNotificationType.DEAL_STAGE;
    case "LEAD_ASSIGNED":
      return CrmNotificationType.LEAD_ASSIGNED;
    case "REMINDER":
      return CrmNotificationType.REMINDER;
    case "GENERAL":
      return CrmNotificationType.GENERAL;
    default:
      if (Object.values(CrmNotificationType).includes(type as CrmNotificationType)) {
        return type as CrmNotificationType;
      }
      return CrmNotificationType.GENERAL;
  }
}

function mapNotificationToResponse(n: any) {
  return {
    id: n.id,
    userId: n.userId,
    type: n.type ? n.type.toLowerCase() : "general",
    title: n.title,
    body: n.body,
    entityType: n.entityType ?? undefined,
    entityId: n.entityId ?? undefined,
    read: n.read,
    createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : n.createdAt,
    updatedAt: n.updatedAt instanceof Date ? n.updatedAt.toISOString() : n.updatedAt,
  };
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string, userId: string) {
    const list = await this.prisma.crmNotification.findMany({
      where: {
        companyId,
        userId,
      },
      orderBy: { createdAt: "desc" },
    });

    return list.map(mapNotificationToResponse);
  }

  async getUnreadCount(companyId: string, userId: string) {
    const count = await this.prisma.crmNotification.count({
      where: {
        companyId,
        userId,
        read: false,
      },
    });

    return { count };
  }

  async markAsRead(id: string, companyId: string, userId: string) {
    const existing = await this.prisma.crmNotification.findFirst({
      where: { id, companyId, userId },
    });

    if (!existing) {
      throw new NotFoundException("Notification not found");
    }

    const updated = await this.prisma.crmNotification.update({
      where: { id },
      data: { read: true },
    });

    return mapNotificationToResponse(updated);
  }

  async markAllAsRead(companyId: string, userId: string) {
    const result = await this.prisma.crmNotification.updateMany({
      where: {
        companyId,
        userId,
        read: false,
      },
      data: { read: true },
    });

    return { count: result.count, success: true };
  }

  async create(data: CreateNotificationDto, companyId: string) {
    if (!data.userId || typeof data.userId !== "string") {
      throw new BadRequestException("Target userId is required");
    }
    if (!data.title || typeof data.title !== "string" || !data.title.trim()) {
      throw new BadRequestException("Notification title is required");
    }
    if (!data.body || typeof data.body !== "string") {
      throw new BadRequestException("Notification body is required");
    }

    // Verify recipient belongs to the same company
    const member = await this.prisma.companyMembership.findFirst({
      where: {
        companyId,
        userId: data.userId,
        status: "ACTIVE",
      },
    });

    if (!member) {
      throw new BadRequestException("Target user does not belong to your company");
    }

    const type = mapNotificationTypeToPrisma(data.type);

    const created = await this.prisma.crmNotification.create({
      data: {
        companyId,
        userId: data.userId,
        type,
        title: data.title.trim(),
        body: data.body.trim(),
        entityType: data.entityType ?? null,
        entityId: data.entityId ?? null,
        read: data.read ?? false,
      },
    });

    return mapNotificationToResponse(created);
  }

  async remove(id: string, companyId: string, userId: string) {
    const existing = await this.prisma.crmNotification.findFirst({
      where: { id, companyId, userId },
    });

    if (!existing) {
      throw new NotFoundException("Notification not found");
    }

    await this.prisma.crmNotification.delete({
      where: { id },
    });

    return { removed: true };
  }
}
