import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

export class CreateBranchDto {
  companyId!: string;
  name!: string;
}

export class UpdateBranchDto {
  name?: string;
}

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateBranchDto, requestingUserCompanyId: string) {
    // The user can only create branches in their own company
    if (data.companyId !== requestingUserCompanyId) {
      throw new ForbiddenException("Cannot create a branch in a company you are not a member of");
    }

    const company = await this.prisma.company.findUnique({
      where: { id: data.companyId, deletedAt: null },
    });
    if (!company) {
      throw new NotFoundException("Company not found");
    }

    const existing = await this.prisma.branch.findFirst({
      where: { companyId: data.companyId, name: data.name },
    });
    if (existing) {
      throw new BadRequestException("Branch with this name already exists in the company");
    }

    return this.prisma.branch.create({
      data: {
        id: `${data.companyId}-${data.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
        companyId: data.companyId,
        name: data.name,
      },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.branch.findMany({
      where: { companyId, deletedAt: null },
    });
  }

  async findOne(id: string, companyId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id, companyId },
    });
    if (!branch || branch.deletedAt) {
      throw new NotFoundException("Branch not found");
    }
    return branch;
  }

  async update(id: string, data: UpdateBranchDto, companyId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id, companyId },
    });
    if (!branch || branch.deletedAt) {
      throw new NotFoundException("Branch not found");
    }

    return this.prisma.branch.update({
      where: { id },
      data: { ...(data.name !== undefined && { name: data.name }) },
    });
  }

  async remove(id: string, companyId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id, companyId },
    });
    if (!branch || branch.deletedAt) {
      throw new NotFoundException("Branch not found");
    }

    return this.prisma.branch.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
