import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

export class CreateLeaveRequestDto {
  employeeId!: string;
  companyId!: string;
  type!: string;
  startDate?: Date;
  endDate?: Date;
  reason!: string;
}

export class UpdateLeaveRequestDto {
  status?: string;
}

@Injectable()
export class LeaveRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateLeaveRequestDto, requestingUserCompanyId: string) {
    // The user can only create leave requests for employees in their own company
    if (data.companyId !== requestingUserCompanyId) {
      throw new ForbiddenException("Cannot create a leave request for a company you are not a member of");
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: data.employeeId, companyId: data.companyId },
    });
    if (!employee || employee.deletedAt) {
      throw new NotFoundException("Employee not found");
    }

    if (data.endDate && data.startDate && data.endDate < data.startDate) {
      throw new BadRequestException("End date must be after start date");
    }

    return this.prisma.leaveRequest.create({
      data: {
        employeeId: data.employeeId,
        companyId: data.companyId,
        type: data.type as any,
        startDate: data.startDate ?? new Date(),
        endDate: data.endDate ?? new Date(),
        reason: data.reason,
        status: "PENDING",
      },
      include: { employee: { include: { user: true } } },
    });
  }

  async findAll(companyId: string, employeeId?: string, status?: string) {
    return this.prisma.leaveRequest.findMany({
      where: {
        companyId,
        ...(employeeId ? { employeeId } : {}),
        ...(status ? { status: status as any } : {}),
      },
      include: { employee: { include: { user: true } }, approvedBy: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string, companyId: string) {
    const leaveRequest = await this.prisma.leaveRequest.findFirst({
      where: { id, companyId },
      include: { employee: { include: { user: true } }, approvedBy: { select: { id: true, name: true, email: true } } },
    });
    if (!leaveRequest) {
      throw new NotFoundException("Leave request not found");
    }
    return leaveRequest;
  }

  async update(id: string, data: UpdateLeaveRequestDto, approvedByUserId: string, companyId: string) {
    const leaveRequest = await this.prisma.leaveRequest.findFirst({
      where: { id, companyId },
    });
    if (!leaveRequest) {
      throw new NotFoundException("Leave request not found");
    }

    return this.prisma.leaveRequest.update({
      where: { id },
      data: {
        ...(data.status !== undefined && { status: data.status as any }),
        ...(data.status && data.status !== "PENDING" && { approvedById: approvedByUserId, approvedAt: new Date() }),
      },
    });
  }
}
