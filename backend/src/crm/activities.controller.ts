import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IsString, IsOptional, IsNumber } from "class-validator";
import { ActivitiesService } from "./activities.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ResponseMessage } from "../common/decorators/response-message.decorator";

export class CreateActivityBody {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsString()
  subject!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  entityType!: string;

  @IsString()
  entityId!: string;

  @IsOptional()
  occurredAt?: string | Date;

  @IsOptional()
  @IsNumber()
  durationMinutes?: number;
}

export class UpdateActivityBody {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  occurredAt?: string | Date;

  @IsOptional()
  @IsNumber()
  durationMinutes?: number;
}

export class ReassignActivitiesBody {
  @IsString()
  fromType!: string;

  @IsString()
  fromId!: string;

  @IsString()
  toType!: string;

  @IsString()
  toId!: string;
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("crm/activities")
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get()
  @ResponseMessage("Activities retrieved")
  async findAll(
    @Query("entityType") entityType?: string,
    @Query("entityId") entityId?: string,
    @CurrentUser() user?: any
  ) {
    const filter = entityType || entityId ? { entityType, entityId } : undefined;
    return this.activitiesService.findAll(user.companyId, filter);
  }

  @Get(":id")
  @ResponseMessage("Activity retrieved")
  async findOne(@Param("id") id: string, @CurrentUser() user: any) {
    return this.activitiesService.findOne(id, user.companyId);
  }

  @Post()
  @ResponseMessage("Activity created")
  async create(@Body() body: CreateActivityBody, @CurrentUser() user: any) {
    return this.activitiesService.create(body, user.companyId, user.userId);
  }

  @Put(":id")
  @ResponseMessage("Activity updated")
  async update(
    @Param("id") id: string,
    @Body() body: UpdateActivityBody,
    @CurrentUser() user: any
  ) {
    return this.activitiesService.update(id, body, user.companyId);
  }

  @Patch(":id")
  @ResponseMessage("Activity updated")
  async patch(
    @Param("id") id: string,
    @Body() body: UpdateActivityBody,
    @CurrentUser() user: any
  ) {
    return this.activitiesService.update(id, body, user.companyId);
  }

  @Post("reassign")
  @ResponseMessage("Activities reassigned")
  async reassign(
    @Body() body: ReassignActivitiesBody,
    @CurrentUser() user: any
  ) {
    return this.activitiesService.reassignEntityActivities(
      user.companyId,
      body.fromType,
      body.fromId,
      body.toType,
      body.toId
    );
  }

  @Delete(":id")
  @RequirePermission("crm.delete")
  @ResponseMessage("Activity deleted")
  async remove(@Param("id") id: string, @CurrentUser() user: any) {
    await this.activitiesService.remove(id, user.companyId);
    return { removed: true };
  }
}
