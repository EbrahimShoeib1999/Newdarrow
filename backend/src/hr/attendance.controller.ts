import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
  Query,
  ForbiddenException,
} from "@nestjs/common";
import { IsString, IsOptional } from "class-validator";
import { AttendanceService } from "./attendance.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

export class CreateAttendanceBody {
  @IsString()
  employeeId!: string;

  @IsString()
  companyId!: string;

  @IsOptional()
  date?: Date;

  @IsOptional()
  checkIn?: Date;

  @IsOptional()
  checkOut?: Date;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateAttendanceBody {
  @IsOptional()
  checkOut?: Date;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

@UseGuards(JwtAuthGuard)
@Controller("hr/attendance")
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post()
  async create(@Body() body: CreateAttendanceBody, @CurrentUser() user: any) {
    const attendance = await this.attendanceService.create(
      { ...body, companyId: user.companyId },
      user.companyId,
    );
    return { data: attendance, message: "Attendance recorded" };
  }

  @Get()
  async findAll(
    @CurrentUser() user: any,
    @Query("employeeId") employeeId?: string,
  ) {
    const attendance = await this.attendanceService.findAll(user.companyId, employeeId);
    return { data: attendance, message: "Attendance listed" };
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentUser() user: any) {
    const attendance = await this.attendanceService.findOne(id, user.companyId);
    return { data: attendance, message: "Attendance retrieved" };
  }

  @Put(":id")
  async update(@Param("id") id: string, @Body() body: UpdateAttendanceBody, @CurrentUser() user: any) {
    const attendance = await this.attendanceService.update(id, body, user.companyId);
    return { data: attendance, message: "Attendance updated" };
  }
}
