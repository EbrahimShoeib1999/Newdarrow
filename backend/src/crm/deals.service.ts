import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { DealStage } from "@prisma/client";

export class CreateDealDto {
  companyId?: string;
  title!: string;
  amount?: number;
  currency?: string;
  stage?: string;
  probability?: number;
  expectedCloseDate?: string | Date | null;
  contactId?: string | null;
  leadId?: string | null;
  assignedToId?: string | null;
  assignedTo?: string | null;
}

export function mapStageToPrisma(stage?: string | null): DealStage {
  if (!stage) return DealStage.PROSPECTING;
  const s = stage.trim().toLowerCase();
  switch (s) {
    case "lead":
    case "prospecting":
      return DealStage.PROSPECTING;
    case "contacted":
    case "needs_analysis":
      return DealStage.NEEDS_ANALYSIS;
    case "qualified":
    case "qualification":
      return DealStage.QUALIFICATION;
    case "proposal_sent":
    case "proposal":
    case "value_proposal":
      return DealStage.VALUE_PROPOSAL;
    case "negotiation":
      return DealStage.NEGOTIATION;
    case "won":
    case "closed_won":
      return DealStage.CLOSED_WON;
    case "lost":
    case "closed_lost":
      return DealStage.CLOSED_LOST;
    default:
      if (Object.values(DealStage).includes(stage as DealStage)) {
        return stage as DealStage;
      }
      return DealStage.PROSPECTING;
  }
}

@Injectable()
export class DealsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateDealDto, requestingUserCompanyId: string) {
    // The deal always belongs to the requesting user's company
    const companyId = requestingUserCompanyId;

    const company = await this.prisma.company.findUnique({
      where: { id: companyId, deletedAt: null },
    });
    if (!company) {
      throw new NotFoundException("Company not found");
    }

    // Cross-tenant validation: contactId
    const contactId = data.contactId || null;
    if (contactId) {
      const contact = await this.prisma.customer.findFirst({
        where: { id: contactId, companyId, deletedAt: null },
      });
      if (!contact) {
        throw new BadRequestException("Contact not found or does not belong to your company");
      }
    }

    // Cross-tenant validation: leadId
    const leadId = data.leadId || null;
    if (leadId) {
      const lead = await this.prisma.lead.findFirst({
        where: { id: leadId, companyId, deletedAt: null },
      });
      if (!lead) {
        throw new BadRequestException("Lead not found or does not belong to your company");
      }
    }

    // Cross-tenant validation: assignedToId
    const rawAssigned = data.assignedToId !== undefined ? data.assignedToId : data.assignedTo;
    let assignedToId: string | null = null;
    if (rawAssigned !== undefined && rawAssigned !== null && rawAssigned.trim() !== "") {
      const trimmed = rawAssigned.trim();
      const assignedUser = await this.prisma.user.findFirst({
        where: {
          id: trimmed,
          deletedAt: null,
          memberships: {
            some: {
              companyId,
              status: "ACTIVE",
            },
          },
        },
      });
      if (!assignedUser) {
        throw new BadRequestException("Assigned user not found or does not belong to your company");
      }
      assignedToId = assignedUser.id;
    }

    const stage = mapStageToPrisma(data.stage);
    const amount = Math.round(Number(data.amount) || 0);
    const probability = Math.round(Number(data.probability) || 0);

    let parsedCloseDate: Date | null = null;
    if (data.expectedCloseDate) {
      parsedCloseDate = new Date(data.expectedCloseDate);
      if (isNaN(parsedCloseDate.getTime())) {
        parsedCloseDate = null;
      }
    }

    return this.prisma.deal.create({
      data: {
        companyId,
        title: data.title,
        amount,
        currency: data.currency ?? "SAR",
        stage,
        probability,
        expectedCloseDate: parsedCloseDate,
        contactId,
        leadId,
        assignedToId,
      },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        contact: { select: { id: true, firstName: true, lastName: true, accountName: true } },
        lead: { select: { id: true, name: true, companyName: true } },
      },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.deal.findMany({
      where: { companyId, deletedAt: null },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        contact: { select: { id: true, firstName: true, lastName: true, accountName: true } },
        lead: { select: { id: true, name: true, companyName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string, companyId: string) {
    const deal = await this.prisma.deal.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        contact: { select: { id: true, firstName: true, lastName: true, accountName: true } },
        lead: { select: { id: true, name: true, companyName: true } },
      },
    });
    if (!deal) {
      throw new NotFoundException("Deal not found");
    }
    return deal;
  }

  async update(id: string, data: Partial<CreateDealDto>, companyId: string) {
    const deal = await this.prisma.deal.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!deal) {
      throw new NotFoundException("Deal not found");
    }

    // Cross-tenant validation: contactId
    if (data.contactId !== undefined && data.contactId !== null) {
      const contact = await this.prisma.customer.findFirst({
        where: { id: data.contactId, companyId, deletedAt: null },
      });
      if (!contact) {
        throw new BadRequestException("Contact not found or does not belong to your company");
      }
    }

    // Cross-tenant validation: leadId
    if (data.leadId !== undefined && data.leadId !== null) {
      const lead = await this.prisma.lead.findFirst({
        where: { id: data.leadId, companyId, deletedAt: null },
      });
      if (!lead) {
        throw new BadRequestException("Lead not found or does not belong to your company");
      }
    }

    let parsedCloseDate: Date | null | undefined = undefined;
    if (data.expectedCloseDate !== undefined) {
      if (data.expectedCloseDate === null) {
        parsedCloseDate = null;
      } else {
        const d = new Date(data.expectedCloseDate);
        parsedCloseDate = isNaN(d.getTime()) ? null : d;
      }
    }

    // Cross-tenant validation: assignedToId
    let assignedToId: string | null | undefined = undefined;
    const rawAssigned =
      data.assignedToId !== undefined
        ? data.assignedToId
        : data.assignedTo !== undefined
        ? data.assignedTo
        : undefined;

    if (rawAssigned !== undefined) {
      if (rawAssigned === null || rawAssigned.trim() === "") {
        assignedToId = null;
      } else {
        const trimmed = rawAssigned.trim();
        const assignedUser = await this.prisma.user.findFirst({
          where: {
            id: trimmed,
            deletedAt: null,
            memberships: {
              some: {
                companyId,
                status: "ACTIVE",
              },
            },
          },
        });
        if (!assignedUser) {
          throw new BadRequestException("Assigned user not found or does not belong to your company");
        }
        assignedToId = assignedUser.id;
      }
    }

    return this.prisma.deal.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.amount !== undefined && { amount: Math.round(Number(data.amount) || 0) }),
        ...(data.currency !== undefined && { currency: data.currency }),
        ...(data.stage !== undefined && { stage: mapStageToPrisma(data.stage) }),
        ...(data.probability !== undefined && {
          probability: Math.round(Number(data.probability) || 0),
        }),
        ...(parsedCloseDate !== undefined && { expectedCloseDate: parsedCloseDate }),
        ...(data.contactId !== undefined && { contactId: data.contactId }),
        ...(data.leadId !== undefined && { leadId: data.leadId }),
        ...(assignedToId !== undefined && { assignedToId }),
      },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        contact: { select: { id: true, firstName: true, lastName: true, accountName: true } },
        lead: { select: { id: true, name: true, companyName: true } },
      },
    });
  }

  async remove(id: string, companyId: string) {
    const deal = await this.prisma.deal.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!deal) {
      throw new NotFoundException("Deal not found");
    }

    return this.prisma.deal.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
