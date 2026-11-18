import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CustomerType } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";

export class CreateCustomerDto {
  companyId!: string;
  type?: string;
  entityType?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
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
  assignedTo?: string;
}

export type UpdateCustomerDto = Partial<CreateCustomerDto>;

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateCustomerDto, requestingUserCompanyId: string) {
    if (data.companyId !== requestingUserCompanyId) {
      throw new ForbiddenException("Cannot create a customer in a company you are not a member of");
    }

    const company = await this.prisma.company.findUnique({
      where: { id: data.companyId, deletedAt: null },
    });
    if (!company) {
      throw new NotFoundException("Company not found");
    }

    let customerType: CustomerType = CustomerType.INDIVIDUAL;
    const rawType = data.type || data.entityType;
    if (rawType) {
      const upper = rawType.toUpperCase();
      if (upper === "COMPANY" || upper === "ESTABLISHMENT" || upper === "GOVERNMENT") {
        customerType = upper as CustomerType;
      }
    }

    let firstName = data.firstName?.trim() || null;
    let lastName = data.lastName?.trim() || null;
    if (!firstName && data.fullName) {
      const parts = data.fullName.trim().split(" ");
      firstName = parts[0] || null;
      lastName = parts.slice(1).join(" ") || null;
    }

    let assignedToId: string | null = null;
    const rawAssigned = data.assignedToId || data.assignedTo;
    if (rawAssigned && rawAssigned.trim() !== "") {
      const user = await this.prisma.user.findFirst({
        where: {
          id: rawAssigned.trim(),
          memberships: { some: { companyId: data.companyId, status: "ACTIVE" } },
        },
      });
      if (user) {
        assignedToId = user.id;
      }
    }

    return this.prisma.customer.create({
      data: {
        companyId: data.companyId,
        type: customerType,
        firstName,
        lastName,
        accountName: data.accountName?.trim() || null,
        legalName: data.legalName?.trim() || null,
        email: data.email?.trim() || null,
        phone: data.phone?.trim() || null,
        whatsappPhone: data.whatsappPhone?.trim() || null,
        website: data.website?.trim() || null,
        commercialRegister: data.commercialRegister?.trim() || null,
        taxNumber: data.taxNumber?.trim() || null,
        city: data.city?.trim() || null,
        country: data.country?.trim() || null,
        status: data.status?.trim() || "active",
        assignedToId,
      },
      include: {
        company: true,
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.customer.findMany({
      where: { companyId, deletedAt: null },
      include: {
        company: true,
        assignedTo: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string, companyId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, companyId },
      include: {
        company: true,
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });
    if (!customer || customer.deletedAt) {
      throw new NotFoundException("Customer not found");
    }
    return customer;
  }

  async update(id: string, data: UpdateCustomerDto, companyId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, companyId },
    });
    if (!customer || customer.deletedAt) {
      throw new NotFoundException("Customer not found");
    }

    let customerType: CustomerType | undefined = undefined;
    const rawType = data.type || data.entityType;
    if (rawType !== undefined) {
      const upper = rawType.toUpperCase();
      if (upper === "COMPANY" || upper === "ESTABLISHMENT" || upper === "GOVERNMENT") {
        customerType = upper as CustomerType;
      } else {
        customerType = CustomerType.INDIVIDUAL;
      }
    }

    let firstName = data.firstName !== undefined ? data.firstName?.trim() || null : undefined;
    let lastName = data.lastName !== undefined ? data.lastName?.trim() || null : undefined;
    if (firstName === undefined && lastName === undefined && data.fullName !== undefined) {
      const parts = data.fullName.trim().split(" ");
      firstName = parts[0] || null;
      lastName = parts.slice(1).join(" ") || null;
    }

    let assignedToId: string | null | undefined = undefined;
    const rawAssigned = data.assignedToId !== undefined ? data.assignedToId : data.assignedTo;
    if (rawAssigned !== undefined) {
      if (rawAssigned && rawAssigned.trim() !== "") {
        const user = await this.prisma.user.findFirst({
          where: {
            id: rawAssigned.trim(),
            memberships: { some: { companyId, status: "ACTIVE" } },
          },
        });
        assignedToId = user ? user.id : null;
      } else {
        assignedToId = null;
      }
    }

    return this.prisma.customer.update({
      where: { id },
      data: {
        ...(customerType !== undefined && { type: customerType }),
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(data.accountName !== undefined && { accountName: data.accountName?.trim() || null }),
        ...(data.legalName !== undefined && { legalName: data.legalName?.trim() || null }),
        ...(data.email !== undefined && { email: data.email?.trim() || null }),
        ...(data.phone !== undefined && { phone: data.phone?.trim() || null }),
        ...(data.whatsappPhone !== undefined && { whatsappPhone: data.whatsappPhone?.trim() || null }),
        ...(data.website !== undefined && { website: data.website?.trim() || null }),
        ...(data.commercialRegister !== undefined && { commercialRegister: data.commercialRegister?.trim() || null }),
        ...(data.taxNumber !== undefined && { taxNumber: data.taxNumber?.trim() || null }),
        ...(data.city !== undefined && { city: data.city?.trim() || null }),
        ...(data.country !== undefined && { country: data.country?.trim() || null }),
        ...(data.status !== undefined && { status: data.status?.trim() || "active" }),
        ...(assignedToId !== undefined && { assignedToId }),
      },
      include: {
        company: true,
        assignedTo: { select: { id: true, name: true, email: true } },
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
