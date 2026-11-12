import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

export class CreateLeadDto {
  companyId!: string;
  name!: string;
  companyName?: string;
  email?: string;
  phone?: string;
  status?: string;
  source?: string;
  priority?: string;
  assignedToId?: string;
  contactId?: string;
  notes?: string;
}

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateLeadDto, requestingUserCompanyId: string) {
    // The user can only create leads in their own company
    if (data.companyId !== requestingUserCompanyId) {
      throw new ForbiddenException("Cannot create a lead in a company you are not a member of");
    }

    const company = await this.prisma.company.findUnique({
      where: { id: data.companyId, deletedAt: null },
    });
    if (!company) {
      throw new NotFoundException("Company not found");
    }

    return this.prisma.lead.create({
      data: {
        companyId: data.companyId,
        name: data.name,
        companyName: data.companyName ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        status: (data.status as any) ?? "NEW",
        source: data.source ?? null,
        priority: data.priority ?? "medium",
        assignedToId: data.assignedToId ?? null,
        contactId: data.contactId ?? null,
        notes: data.notes ?? null,
      },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        contact: { select: { id: true, firstName: true, lastName: true, accountName: true } },
      },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.lead.findMany({
      where: { companyId, deletedAt: null },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        contact: { select: { id: true, firstName: true, lastName: true, accountName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string, companyId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, companyId },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        contact: { select: { id: true, firstName: true, lastName: true, accountName: true } },
      },
    });
    if (!lead || lead.deletedAt) {
      throw new NotFoundException("Lead not found");
    }
    return lead;
  }

  async update(id: string, data: Partial<CreateLeadDto>, companyId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, companyId },
    });
    if (!lead || lead.deletedAt) {
      throw new NotFoundException("Lead not found");
    }

    return this.prisma.lead.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.companyName !== undefined && { companyName: data.companyName }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.status !== undefined && { status: data.status as any }),
        ...(data.source !== undefined && { source: data.source }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.assignedToId !== undefined && { assignedToId: data.assignedToId }),
        ...(data.contactId !== undefined && { contactId: data.contactId }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    });
  }

  async remove(id: string, companyId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, companyId },
    });
    if (!lead || lead.deletedAt) {
      throw new NotFoundException("Lead not found");
    }

    return this.prisma.lead.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
