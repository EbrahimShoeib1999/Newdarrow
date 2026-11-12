import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

export class CreateDealDto {
  companyId!: string;
  title!: string;
  amount!: number;
  currency?: string;
  stage?: string;
  probability?: number;
  expectedCloseDate?: Date;
  contactId?: string;
  leadId?: string;
  assignedToId?: string;
}

@Injectable()
export class DealsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateDealDto, requestingUserCompanyId: string) {
    // The user can only create deals in their own company
    if (data.companyId !== requestingUserCompanyId) {
      throw new ForbiddenException("Cannot create a deal in a company you are not a member of");
    }

    const company = await this.prisma.company.findUnique({
      where: { id: data.companyId, deletedAt: null },
    });
    if (!company) {
      throw new NotFoundException("Company not found");
    }

    return this.prisma.deal.create({
      data: {
        companyId: data.companyId,
        title: data.title,
        amount: data.amount,
        currency: data.currency ?? "SAR",
        stage: (data.stage as any) ?? "PROSPECTING",
        probability: data.probability ?? 0,
        expectedCloseDate: data.expectedCloseDate ?? null,
        contactId: data.contactId ?? null,
        leadId: data.leadId ?? null,
        assignedToId: data.assignedToId ?? null,
      },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        contact: { select: { id: true, firstName: true, lastName: true, accountName: true } },
      },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.deal.findMany({
      where: { companyId, deletedAt: null },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        contact: { select: { id: true, firstName: true, lastName: true, accountName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string, companyId: string) {
    const deal = await this.prisma.deal.findFirst({
      where: { id, companyId },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        contact: { select: { id: true, firstName: true, lastName: true, accountName: true } },
      },
    });
    if (!deal || deal.deletedAt) {
      throw new NotFoundException("Deal not found");
    }
    return deal;
  }

  async update(id: string, data: Partial<CreateDealDto>, companyId: string) {
    const deal = await this.prisma.deal.findFirst({
      where: { id, companyId },
    });
    if (!deal || deal.deletedAt) {
      throw new NotFoundException("Deal not found");
    }

    return this.prisma.deal.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.amount !== undefined && { amount: data.amount }),
        ...(data.currency !== undefined && { currency: data.currency }),
        ...(data.stage !== undefined && { stage: data.stage as any }),
        ...(data.probability !== undefined && { probability: data.probability }),
        ...(data.expectedCloseDate !== undefined && { expectedCloseDate: data.expectedCloseDate }),
        ...(data.contactId !== undefined && { contactId: data.contactId }),
        ...(data.leadId !== undefined && { leadId: data.leadId }),
        ...(data.assignedToId !== undefined && { assignedToId: data.assignedToId }),
      },
    });
  }

  async remove(id: string, companyId: string) {
    const deal = await this.prisma.deal.findFirst({
      where: { id, companyId },
    });
    if (!deal || deal.deletedAt) {
      throw new NotFoundException("Deal not found");
    }

    return this.prisma.deal.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
