import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

export interface CreateContractDto {
  title?: string;
  status?: string;
  form: any;
  contactId?: string;
  dealId?: string;
  approvalStatus?: string;
  convertedToTasks?: boolean;
  createdTaskIds?: string[];
}

export interface UpdateContractDto {
  title?: string;
  status?: string;
  form?: any;
  contactId?: string;
  dealId?: string;
  approvalStatus?: string;
  convertedToTasks?: boolean;
  createdTaskIds?: string[];
}

function mapContractToResponse(c: any) {
  return {
    id: c.id,
    title: c.title,
    status: c.status || "draft",
    form: c.form,
    contactId: c.contactId ?? undefined,
    dealId: c.dealId ?? undefined,
    createdBy: c.createdBy ?? undefined,
    approvalStatus: c.approvalStatus || "pending",
    approvedAt: c.approvedAt instanceof Date ? c.approvedAt.toISOString() : c.approvedAt,
    approvedBy: c.approvedBy ?? undefined,
    convertedToTasks: Boolean(c.convertedToTasks),
    createdTaskIds: c.createdTaskIds ?? undefined,
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
    updatedAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : c.updatedAt,
  };
}

@Injectable()
export class ContractsService {
  constructor(private readonly prisma: PrismaService) {}

  private async validateEntityReferences(companyId: string, contactId?: string, dealId?: string) {
    if (contactId) {
      const contact = await this.prisma.customer.findFirst({
        where: { id: contactId, companyId, deletedAt: null },
      });
      if (!contact) {
        throw new BadRequestException("Referenced customer/contact does not exist or does not belong to your company");
      }
    }
    if (dealId) {
      const deal = await this.prisma.deal.findFirst({
        where: { id: dealId, companyId, deletedAt: null },
      });
      if (!deal) {
        throw new BadRequestException("Referenced deal does not exist or does not belong to your company");
      }
    }
  }

  async findAll(companyId: string, filter?: { contactId?: string; dealId?: string; status?: string }) {
    const where: any = {
      companyId,
      deletedAt: null,
    };
    if (filter?.contactId) where.contactId = filter.contactId;
    if (filter?.dealId) where.dealId = filter.dealId;
    if (filter?.status) where.status = filter.status;

    const list = await this.prisma.crmContract.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return list.map(mapContractToResponse);
  }

  async findOne(id: string, companyId: string) {
    const contract = await this.prisma.crmContract.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!contract) {
      throw new NotFoundException("Contract not found");
    }
    return mapContractToResponse(contract);
  }

  async create(data: CreateContractDto, companyId: string, userId: string) {
    const title = data.title?.trim() || data.form?.title?.trim() || "عقد جديد";
    if (!data.form || typeof data.form !== "object") {
      throw new BadRequestException("Contract form payload is required");
    }

    const contactId = data.contactId || data.form?.contactId || undefined;
    const dealId = data.dealId || data.form?.dealId || undefined;

    await this.validateEntityReferences(companyId, contactId, dealId);

    const created = await this.prisma.crmContract.create({
      data: {
        companyId,
        title,
        status: data.status || "draft",
        form: data.form,
        contactId: contactId || null,
        dealId: dealId || null,
        createdBy: userId,
        approvalStatus: data.approvalStatus || "pending",
        convertedToTasks: Boolean(data.convertedToTasks),
        createdTaskIds: data.createdTaskIds ? (data.createdTaskIds as any) : undefined,
      },
    });

    return mapContractToResponse(created);
  }

  async update(id: string, data: UpdateContractDto, companyId: string) {
    const existing = await this.prisma.crmContract.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException("Contract not found");
    }

    const contactId = data.contactId !== undefined ? (data.contactId || undefined) : (existing.contactId || undefined);
    const dealId = data.dealId !== undefined ? (data.dealId || undefined) : (existing.dealId || undefined);

    if (data.contactId || data.dealId) {
      await this.validateEntityReferences(companyId, contactId, dealId);
    }

    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title.trim();
    if (data.status !== undefined) updateData.status = data.status;
    if (data.form !== undefined) updateData.form = data.form;
    if (data.contactId !== undefined) updateData.contactId = data.contactId || null;
    if (data.dealId !== undefined) updateData.dealId = data.dealId || null;
    if (data.approvalStatus !== undefined) updateData.approvalStatus = data.approvalStatus;
    if (data.convertedToTasks !== undefined) updateData.convertedToTasks = Boolean(data.convertedToTasks);
    if (data.createdTaskIds !== undefined) updateData.createdTaskIds = data.createdTaskIds as any;

    const updated = await this.prisma.crmContract.update({
      where: { id },
      data: updateData,
    });

    return mapContractToResponse(updated);
  }

  async approve(id: string, companyId: string, userId: string) {
    const existing = await this.prisma.crmContract.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException("Contract not found");
    }

    const updated = await this.prisma.crmContract.update({
      where: { id },
      data: {
        approvalStatus: "approved",
        approvedAt: new Date(),
        approvedBy: userId,
      },
    });

    return mapContractToResponse(updated);
  }

  async remove(id: string, companyId: string) {
    const existing = await this.prisma.crmContract.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException("Contract not found");
    }

    await this.prisma.crmContract.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { success: true };
  }
}
