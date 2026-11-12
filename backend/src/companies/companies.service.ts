import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { Prisma } from "@prisma/client";

export class CreateCompanyDto {
  name!: string;
  primaryActivity?: string;
  defaultCurrency?: string;
  settings?: Record<string, unknown>;
}

export class UpdateCompanyDto {
  name?: string;
  primaryActivity?: string;
  defaultCurrency?: string;
  settings?: Record<string, unknown>;
}

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateCompanyDto, ownerUserId: string) {
    const company = await this.prisma.company.create({
      data: {
        id: data.name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
        name: data.name,
        primaryActivity: data.primaryActivity ?? null,
        defaultCurrency: data.defaultCurrency ?? "SAR",
        settings: (data.settings ?? {}) as Prisma.InputJsonValue,
        ownerId: ownerUserId,
      },
      include: { branches: true, departments: true },
    });

    // Make the owner a platform_admin member of the company
    await this.prisma.companyMembership.create({
      data: {
        userId: ownerUserId,
        companyId: company.id,
        role: "ADMIN",
        joinedAt: new Date(),
        status: "ACTIVE",
      },
    });

    return company;
  }

  async findAll(companyId: string) {
    // A user can only see their own company
    return this.prisma.company.findMany({
      where: { id: companyId, deletedAt: null },
      include: { _count: { select: { branches: true, departments: true, memberships: true } } },
    });
  }

  async findOne(id: string, companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: { branches: true, departments: true, memberships: true },
    });
    if (!company || company.deletedAt || company.id !== companyId) {
      throw new NotFoundException("Company not found");
    }
    return company;
  }

  async update(id: string, data: UpdateCompanyDto, companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
    });
    if (!company || company.deletedAt || company.id !== companyId) {
      throw new NotFoundException("Company not found");
    }

    return this.prisma.company.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.primaryActivity !== undefined && { primaryActivity: data.primaryActivity }),
        ...(data.defaultCurrency !== undefined && { defaultCurrency: data.defaultCurrency }),
        ...(data.settings !== undefined && { settings: data.settings as Prisma.InputJsonValue }),
      },
    });
  }

  async remove(id: string, companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
    });
    if (!company || company.deletedAt || company.id !== companyId) {
      throw new NotFoundException("Company not found");
    }

    return this.prisma.company.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async getMemberships(companyId: string) {
    // Verify the company exists and is not deleted
    const company = await this.prisma.company.findUnique({
      where: { id: companyId, deletedAt: null },
      select: { id: true },
    });
    if (!company) {
      throw new NotFoundException("Company not found");
    }

    return this.prisma.companyMembership.findMany({
      where: { companyId, status: "ACTIVE" },
      include: { user: { select: { id: true, email: true, name: true, nameAr: true } } },
    });
  }
}
