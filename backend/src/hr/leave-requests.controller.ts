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
import { LeaveRequestsService } from "./leave-requests.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

export class CreateLeaveRequestBody {
  @IsString()
  employeeId!: string;

  @IsString()
  companyId!: string;

  @IsString()
  type!: string;

  @IsOptional()
  startDate?: Date;

  @IsOptional()
  endDate?: Date;

  @IsString()
  reason!: string;
}

export class UpdateLeaveRequestBody {
  @IsOptional()
  @IsString()
  status?: string;
}

@UseGuards(JwtAuthGuard)
@Controller("hr/leave-requests")
export class LeaveRequestsController {
  constructor(private readonly leaveRequestsService: LeaveRequestsService) {}

  @Post()
  async create(@Body() body: CreateLeaveRequestBody, @CurrentUser() user: any) {
    const leaveRequest = await this.leaveRequestsService.create(
      { ...body, companyId: user.companyId },
      user.companyId,
    );
    return { data: leaveRequest, message: "Leave request created" };
  }

  @Get()
  async findAll(
    @CurrentUser() user: any,
    @Query("employeeId") employeeId?: string,
    @Query("status") status?: string,
  ) {
    const requests = await this.leaveRequestsService.findAll(user.companyId, employeeId, status);
    return { data: requests, message: "Leave requests listed" };
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentUser() user: any) {
    const leaveRequest = await this.leaveRequestsService.findOne(id, user.companyId);
    return { data: leaveRequest, message: "Leave request retrieved" };
  }

  @Put(":id")
  async update(
    @Param("id") id: string,
    @Body() body: UpdateLeaveRequestBody,
    @CurrentUser() user: any,
  ) {
    const leaveRequest = await this.leaveRequestsService.update(id, body, user.userId, user.companyId);
    return { data: leaveRequest, message: "Leave request updated" };
  }
}
