import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

export interface CreateCrmTaskDto {
  title: string;
  description?: string;
  taskType?: string;
  status?: string;
  priority?: string;
  dueDate?: string | Date | null;
  entityType?: string;
  entityId: string;
  assigneeId?: string | null;
  ownerId?: string | null;
  tags?: string[];
}

export interface UpdateCrmTaskDto {
  title?: string;
  description?: string;
  taskType?: string;
  status?: string;
  priority?: string;
  dueDate?: string | Date | null;
  entityType?: string;
  entityId?: string;
  assigneeId?: string | null;
  ownerId?: string | null;
  tags?: string[];
}

function mapTaskToResponse(t: any) {
  return {
    id: t.id,
    title: t.title,
    description: t.description ?? undefined,
    taskType: t.taskType || "follow_up",
    status: t.status || "pending",
    priority: t.priority || "medium",
    dueDate: t.dueDate instanceof Date ? t.dueDate.toISOString() : t.dueDate,
    entityType: t.entityType || "lead",
    entityId: t.entityId,
    assigneeId: t.assigneeId ?? null,
    ownerId: t.ownerId ?? null,
    tags: Array.isArray(t.tags) ? t.tags : [],
    createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
    updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : t.updatedAt,
  };
}

@Injectable()
export class CrmTasksService {
  constructor(private readonly prisma: PrismaService) {}

  private async validateTargetEntity(companyId: string, entityType: string, entityId: string) {
    if (!entityId) return;
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
    }
  }

  async findAll(
    companyId: string,
    filter?: {
      status?: string;
      entityType?: string;
      entityId?: string;
      assigneeId?: string;
      taskType?: string;
    }
  ) {
    const where: any = {
      companyId,
      deletedAt: null,
    };
    if (filter?.status) where.status = filter.status;
    if (filter?.entityType) where.entityType = filter.entityType.toLowerCase();
    if (filter?.entityId) where.entityId = filter.entityId;
    if (filter?.assigneeId) where.assigneeId = filter.assigneeId;
    if (filter?.taskType) where.taskType = filter.taskType;

    const list = await this.prisma.crmTask.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return list.map(mapTaskToResponse);
  }

  async findOne(id: string, companyId: string) {
    const task = await this.prisma.crmTask.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!task) {
      throw new NotFoundException("Task not found");
    }
    return mapTaskToResponse(task);
  }

  async create(data: CreateCrmTaskDto, companyId: string, userId: string) {
    if (!data.title || typeof data.title !== "string" || !data.title.trim()) {
      throw new BadRequestException("Task title is required");
    }

    const entityType = data.entityType ? data.entityType.trim().toLowerCase() : "lead";
    if (data.entityId) {
      await this.validateTargetEntity(companyId, entityType, data.entityId);
    }

    let dueDate: Date | null = null;
    if (data.dueDate) {
      const parsed = new Date(data.dueDate);
      if (!isNaN(parsed.getTime())) dueDate = parsed;
    }

    const created = await this.prisma.crmTask.create({
      data: {
        companyId,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        taskType: data.taskType || "follow_up",
        status: data.status || "pending",
        priority: data.priority || "medium",
        dueDate,
        entityType,
        entityId: data.entityId || "",
        assigneeId: data.assigneeId || null,
        ownerId: data.ownerId || userId,
        tags: Array.isArray(data.tags) ? (data.tags as any) : undefined,
      },
    });

    return mapTaskToResponse(created);
  }

  async update(id: string, data: UpdateCrmTaskDto, companyId: string) {
    const existing = await this.prisma.crmTask.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException("Task not found");
    }

    const targetType = data.entityType ? data.entityType.trim().toLowerCase() : existing.entityType;
    const targetId = data.entityId !== undefined ? data.entityId : existing.entityId;

    if (data.entityType || data.entityId) {
      await this.validateTargetEntity(companyId, targetType, targetId);
    }

    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title.trim();
    if (data.description !== undefined) updateData.description = data.description?.trim() || null;
    if (data.taskType !== undefined) updateData.taskType = data.taskType;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.dueDate !== undefined) {
      if (data.dueDate === null) {
        updateData.dueDate = null;
      } else {
        const parsed = new Date(data.dueDate);
        updateData.dueDate = !isNaN(parsed.getTime()) ? parsed : null;
      }
    }
    if (data.entityType !== undefined) updateData.entityType = data.entityType.trim().toLowerCase();
    if (data.entityId !== undefined) updateData.entityId = data.entityId;
    if (data.assigneeId !== undefined) updateData.assigneeId = data.assigneeId || null;
    if (data.ownerId !== undefined) updateData.ownerId = data.ownerId || null;
    if (data.tags !== undefined) updateData.tags = data.tags as any;

    const updated = await this.prisma.crmTask.update({
      where: { id },
      data: updateData,
    });

    return mapTaskToResponse(updated);
  }

  async remove(id: string, companyId: string) {
    const existing = await this.prisma.crmTask.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException("Task not found");
    }

    await this.prisma.crmTask.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { success: true };
  }
}
