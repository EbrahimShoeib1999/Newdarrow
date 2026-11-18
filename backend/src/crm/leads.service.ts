import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { LeadStatus } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";

export class CreateLeadDto {
  companyId!: string;
  name!: string;
  companyName?: string;
  company?: string;
  email?: string;
  phone?: string;
  status?: string;
  source?: string;
  priority?: string;
  assignedToId?: string;
  assignedTo?: string;
  contactId?: string;
  notes?: string;
}

export function normalizeBackendStatus(status?: string): LeadStatus {
  if (!status) return LeadStatus.NEW;
  const s = status.toUpperCase();
  if (s === "PROPOSAL_SENT" || s === "PROPOSAL") return LeadStatus.PROPOSAL;
  if (s === "WON" || s === "CLOSED_WON") return LeadStatus.CLOSED_WON;
  if (s === "LOST" || s === "CLOSED_LOST") return LeadStatus.CLOSED_LOST;
  if (Object.values(LeadStatus).includes(s as LeadStatus)) {
    return s as LeadStatus;
  }
  return LeadStatus.NEW;
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
        companyName: data.companyName ?? data.company ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        status: normalizeBackendStatus(data.status),
        source: data.source ?? null,
        priority: data.priority ?? "medium",
        assignedToId: data.assignedToId ?? data.assignedTo ?? null,
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
      where: { id, companyId, deletedAt: null },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        contact: { select: { id: true, firstName: true, lastName: true, accountName: true } },
      },
    });
    if (!lead) {
      throw new NotFoundException("Lead not found");
    }
    return lead;
  }

  async update(id: string, data: Partial<CreateLeadDto>, companyId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!lead) {
      throw new NotFoundException("Lead not found");
    }

    const companyNameVal = data.companyName !== undefined ? data.companyName : data.company;
    const assignedVal = data.assignedToId !== undefined ? data.assignedToId : data.assignedTo;

    return this.prisma.lead.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(companyNameVal !== undefined && { companyName: companyNameVal ?? null }),
        ...(data.email !== undefined && { email: data.email ?? null }),
        ...(data.phone !== undefined && { phone: data.phone ?? null }),
        ...(data.status !== undefined && { status: normalizeBackendStatus(data.status) }),
        ...(data.source !== undefined && { source: data.source ?? null }),
        ...(data.priority !== undefined && { priority: data.priority ?? "medium" }),
        ...(assignedVal !== undefined && { assignedToId: assignedVal ?? null }),
        ...(data.contactId !== undefined && { contactId: data.contactId ?? null }),
        ...(data.notes !== undefined && { notes: data.notes ?? null }),
      },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        contact: { select: { id: true, firstName: true, lastName: true, accountName: true } },
      },
    });
  }

  async remove(id: string, companyId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!lead) {
      throw new NotFoundException("Lead not found");
    }

    return this.prisma.lead.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
