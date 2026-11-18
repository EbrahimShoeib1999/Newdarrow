import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

export class CreateEmployeeDto {
  userId!: string;
  companyId!: string;
  branchId?: string;
  departmentId?: string;
  employeeNumber!: string;
  jobTitle!: string;
  jobTitleAr?: string;
  joiningDate?: Date;
  salary?: number;
  currency?: string;
  phone?: string;
  address?: string;
  workLocationId?: string;
  requireGps?: boolean;
  mandatoryGps?: boolean;
}

export class UpdateEmployeeDto {
  jobTitle?: string;
  jobTitleAr?: string;
  branchId?: string;
  departmentId?: string;
  employmentStatus?: string;
  salary?: number;
  currency?: string;
  phone?: string;
  address?: string;
}

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateEmployeeDto, requestingUserCompanyId: string) {
    // The user can only create employees in their own company
    if (data.companyId !== requestingUserCompanyId) {
      throw new ForbiddenException("Cannot create an employee in a company you are not a member of");
    }

    const company = await this.prisma.company.findUnique({
      where: { id: data.companyId, deletedAt: null },
    });
    if (!company) {
      throw new NotFoundException("Company not found");
    }

    const existing = await this.prisma.employee.findUnique({ where: { employeeNumber: data.employeeNumber } });
    if (existing) {
      throw new BadRequestException("Employee number already exists");
    }

    const user = await this.prisma.user.findUnique({ where: { id: data.userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    // Employee's company must match the account's membership company.
    // An account belongs to exactly one company; an Employee record cannot
    // be linked to a different company than the account's membership.
    const userMembership = await this.prisma.companyMembership.findUnique({
      where: { userId: data.userId },
    });
    if (!userMembership || userMembership.companyId !== data.companyId) {
      throw new ForbiddenException(
        "Employee company must match the account's company membership",
      );
    }

    if (data.branchId) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: data.branchId },
      });
      if (!branch || branch.companyId !== data.companyId || branch.deletedAt) {
        throw new BadRequestException("Branch does not belong to the employee company");
      }
    }

    return this.prisma.employee.create({
      data: {
        userId: data.userId,
        companyId: data.companyId,
        branchId: data.branchId ?? null,
        departmentId: data.departmentId ?? null,
        employeeNumber: data.employeeNumber,
        jobTitle: data.jobTitle,
        jobTitleAr: data.jobTitleAr ?? "",
        joiningDate: data.joiningDate ?? new Date(),
        salary: data.salary ?? null,
        currency: data.currency ?? "SAR",
        phone: data.phone ?? null,
        address: data.address ?? null,
        workLocationId: data.workLocationId ?? null,
        requireGps: data.requireGps ?? false,
        mandatoryGps: data.mandatoryGps ?? false,
      },
      include: { user: true, company: true, branch: true, department: true },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.employee.findMany({
      where: { companyId, deletedAt: null },
      include: { user: true, company: true, branch: true, department: true },
    });
  }

  async findOne(id: string, companyId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, companyId },
      include: { user: true, company: true, branch: true, department: true },
    });
    if (!employee || employee.deletedAt) {
      throw new NotFoundException("Employee not found");
    }
    return employee;
  }

  async update(id: string, data: UpdateEmployeeDto, companyId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, companyId },
    });
    if (!employee || employee.deletedAt) {
      throw new NotFoundException("Employee not found");
    }

    if (data.branchId) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: data.branchId },
      });
      if (!branch || branch.companyId !== companyId || branch.deletedAt) {
        throw new BadRequestException("Branch does not belong to the employee company");
      }
    }

    return this.prisma.employee.update({
      where: { id },
      data: {
        ...(data.jobTitle !== undefined && { jobTitle: data.jobTitle }),
        ...(data.jobTitleAr !== undefined && { jobTitleAr: data.jobTitleAr }),
        ...(data.branchId !== undefined && { branchId: data.branchId ?? null }),
        ...(data.departmentId !== undefined && { departmentId: data.departmentId ?? null }),
        ...(data.employmentStatus !== undefined && { employmentStatus: data.employmentStatus as any }),
        ...(data.salary !== undefined && { salary: data.salary }),
        ...(data.currency !== undefined && { currency: data.currency }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.address !== undefined && { address: data.address }),
      } as any,
    });
  }

  async remove(id: string, companyId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, companyId },
    });
    if (!employee || employee.deletedAt) {
      throw new NotFoundException("Employee not found");
    }

    return this.prisma.employee.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
