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
import { IsString, IsOptional } from "class-validator";
import { CrmTasksService } from "./crm-tasks.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ResponseMessage } from "../common/decorators/response-message.decorator";

export class CreateCrmTaskBody {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  taskType?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  dueDate?: string | Date;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsString()
  entityId!: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  tags?: string[];
}

export class UpdateCrmTaskBody {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  taskType?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  dueDate?: string | Date;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  tags?: string[];
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("crm/tasks")
export class CrmTasksController {
  constructor(private readonly crmTasksService: CrmTasksService) {}

  @Get()
  @ResponseMessage("Tasks retrieved")
  async findAll(
    @Query("status") status?: string,
    @Query("entityType") entityType?: string,
    @Query("entityId") entityId?: string,
    @Query("assigneeId") assigneeId?: string,
    @Query("taskType") taskType?: string,
    @CurrentUser() user?: any
  ) {
    return this.crmTasksService.findAll(user.companyId, {
      status,
      entityType,
      entityId,
      assigneeId,
      taskType,
    });
  }

  @Get(":id")
  @ResponseMessage("Task retrieved")
  async findOne(@Param("id") id: string, @CurrentUser() user: any) {
    return this.crmTasksService.findOne(id, user.companyId);
  }

  @Post()
  @ResponseMessage("Task created")
  async create(@Body() body: CreateCrmTaskBody, @CurrentUser() user: any) {
    return this.crmTasksService.create(body, user.companyId, user.userId || user.id);
  }

  @Put(":id")
  @ResponseMessage("Task updated")
  async update(
    @Param("id") id: string,
    @Body() body: UpdateCrmTaskBody,
    @CurrentUser() user: any
  ) {
    return this.crmTasksService.update(id, body, user.companyId);
  }

  @Patch(":id")
  @ResponseMessage("Task updated")
  async patch(
    @Param("id") id: string,
    @Body() body: UpdateCrmTaskBody,
    @CurrentUser() user: any
  ) {
    return this.crmTasksService.update(id, body, user.companyId);
  }

  @Delete(":id")
  @ResponseMessage("Task deleted")
  async remove(@Param("id") id: string, @CurrentUser() user: any) {
    return this.crmTasksService.remove(id, user.companyId);
  }
}
