import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

export class CreateAttendanceDto {
  employeeId!: string;
  companyId!: string;
  date?: Date;
  checkIn?: Date;
  checkOut?: Date;
  status?: string;
  location?: string;
  notes?: string;
}

export class UpdateAttendanceDto {
  checkOut?: Date;
  status?: string;
  notes?: string;
}

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateAttendanceDto, requestingUserCompanyId: string) {
    // The user can only record attendance for employees in their own company
    if (data.companyId !== requestingUserCompanyId) {
      throw new ForbiddenException("Cannot record attendance for a company you are not a member of");
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: data.employeeId, companyId: data.companyId },
    });
    if (!employee || employee.deletedAt) {
      throw new NotFoundException("Employee not found");
    }

    const date = data.date ?? new Date();
    const existing = await this.prisma.attendance.findFirst({
      where: { employeeId: data.employeeId, date },
    });
    if (existing) {
      throw new BadRequestException("Attendance record already exists for this date");
    }

    let lateMinutes = 0;
    if (data.checkIn) {
      const startOfDay = new Date(date);
      startOfDay.setHours(9, 0, 0, 0); // 9 AM start
      const diffMs = data.checkIn.getTime() - startOfDay.getTime();
      lateMinutes = diffMs > 0 ? Math.floor(diffMs / 60000) : 0;
    }

    return this.prisma.attendance.create({
      data: {
        employeeId: data.employeeId,
        companyId: data.companyId,
        date,
        checkIn: data.checkIn ?? null,
        checkOut: data.checkOut ?? null,
        status: data.status ?? "present",
        lateMinutes,
        location: data.location ?? null,
        notes: data.notes ?? null,
      },
      include: { employee: { include: { user: true } } },
    });
  }

  async findAll(companyId: string, employeeId?: string) {
    return this.prisma.attendance.findMany({
      where: {
        companyId,
        ...(employeeId ? { employeeId } : {}),
      },
      include: { employee: { include: { user: true } } },
      orderBy: { date: "desc" },
    });
  }

  async findOne(id: string, companyId: string) {
    const attendance = await this.prisma.attendance.findFirst({
      where: { id, companyId },
      include: { employee: { include: { user: true } } },
    });
    if (!attendance) {
      throw new NotFoundException("Attendance record not found");
    }
    return attendance;
  }

  async update(id: string, data: UpdateAttendanceDto, companyId: string) {
    const attendance = await this.prisma.attendance.findFirst({
      where: { id, companyId },
    });
    if (!attendance) {
      throw new NotFoundException("Attendance record not found");
    }

    return this.prisma.attendance.update({
      where: { id },
      data: {
        ...(data.checkOut !== undefined && { checkOut: data.checkOut }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    });
  }
}
