import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

export class CreateCustomerDto {
  companyId!: string;
  type?: string;
  firstName?: string;
  lastName?: string;
  accountName?: string;
  legalName?: string;
  email?: string;
  phone?: string;
  whatsappPhone?: string;
  website?: string;
  commercialRegister?: string;
  taxNumber?: string;
  city?: string;
  country?: string;
  status?: string;
  assignedToId?: string;
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateCustomerDto, requestingUserCompanyId: string) {
    // The user can only create customers in their own company
    if (data.companyId !== requestingUserCompanyId) {
      throw new ForbiddenException("Cannot create a customer in a company you are not a member of");
    }

    const company = await this.prisma.company.findUnique({
      where: { id: data.companyId, deletedAt: null },
    });
    if (!company) {
      throw new NotFoundException("Company not found");
    }

    return this.prisma.customer.create({
      data: {
        companyId: data.companyId,
        type: (data.type as any) ?? "INDIVIDUAL",
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        accountName: data.accountName ?? null,
        legalName: data.legalName ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        whatsappPhone: data.whatsappPhone ?? null,
        website: data.website ?? null,
        commercialRegister: data.commercialRegister ?? null,
        taxNumber: data.taxNumber ?? null,
        city: data.city ?? null,
        country: data.country ?? null,
        status: data.status ?? "active",
        assignedToId: data.assignedToId ?? null,
      },
      include: { company: true, assignedTo: { select: { id: true, name: true, email: true } } },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.customer.findMany({
      where: { companyId, deletedAt: null },
      include: { assignedTo: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string, companyId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, companyId },
      include: { assignedTo: { select: { id: true, name: true, email: true } } },
    });
    if (!customer || customer.deletedAt) {
      throw new NotFoundException("Customer not found");
    }
    return customer;
  }

  async update(id: string, data: Partial<CreateCustomerDto>, companyId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, companyId },
    });
    if (!customer || customer.deletedAt) {
      throw new NotFoundException("Customer not found");
    }

    return this.prisma.customer.update({
      where: { id },
      data: {
        ...(data.type !== undefined && { type: data.type as any }),
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
        ...(data.accountName !== undefined && { accountName: data.accountName }),
        ...(data.legalName !== undefined && { legalName: data.legalName }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.whatsappPhone !== undefined && { whatsappPhone: data.whatsappPhone }),
        ...(data.website !== undefined && { website: data.website }),
        ...(data.commercialRegister !== undefined && { commercialRegister: data.commercialRegister }),
        ...(data.taxNumber !== undefined && { taxNumber: data.taxNumber }),
        ...(data.city !== undefined && { city: data.city }),
        ...(data.country !== undefined && { country: data.country }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.assignedToId !== undefined && { assignedToId: data.assignedToId }),
      },
    });
  }

  async remove(id: string, companyId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, companyId },
    });
    if (!customer || customer.deletedAt) {
      throw new NotFoundException("Customer not found");
    }

    return this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
