import { Module } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { EmployeesController } from "./employees.controller";
import { EmployeesService } from "./employees.service";
import { AttendanceController } from "./attendance.controller";
import { AttendanceService } from "./attendance.service";
import { LeaveRequestsController } from "./leave-requests.controller";
import { LeaveRequestsService } from "./leave-requests.service";

@Module({
  controllers: [EmployeesController, AttendanceController, LeaveRequestsController],
  providers: [EmployeesService, PrismaService, AttendanceService, LeaveRequestsService],
  exports: [EmployeesService, AttendanceService, LeaveRequestsService],
})
export class HrModule {}
