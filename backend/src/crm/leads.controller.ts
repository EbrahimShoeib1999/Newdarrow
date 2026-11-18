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
} from "@nestjs/common";
import { IsString, IsOptional } from "class-validator";
import { LeadsService } from "./leads.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ResponseMessage } from "../common/decorators/response-message.decorator";

export class CreateLeadBody {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateLeadBody {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("crm/leads")
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  @ResponseMessage("Lead created")
  async create(@Body() body: CreateLeadBody, @CurrentUser() user: any) {
    return this.leadsService.create(
      { ...body, companyId: user.companyId },
      user.companyId,
    );
  }

  @Get()
  @ResponseMessage("Leads listed")
  async findAll(@CurrentUser() user: any) {
    return this.leadsService.findAll(user.companyId);
  }

  @Get(":id")
  @ResponseMessage("Lead retrieved")
  async findOne(@Param("id") id: string, @CurrentUser() user: any) {
    return this.leadsService.findOne(id, user.companyId);
  }

  @Put(":id")
  @ResponseMessage("Lead updated")
  async update(@Param("id") id: string, @Body() body: UpdateLeadBody, @CurrentUser() user: any) {
    return this.leadsService.update(id, body, user.companyId);
  }

  @Delete(":id")
  @RequirePermission("crm.delete")
  @ResponseMessage("Lead deleted")
  async remove(@Param("id") id: string, @CurrentUser() user: any) {
    await this.leadsService.remove(id, user.companyId);
    return { removed: true };
  }
}
