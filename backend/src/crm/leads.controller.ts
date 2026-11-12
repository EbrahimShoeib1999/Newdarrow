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
import { LeadsService } from "./leads.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

export class CreateLeadBody {
  @IsString()
  companyId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  companyName?: string;

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
  contactId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

@UseGuards(JwtAuthGuard)
@Controller("crm/leads")
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  async create(@Body() body: CreateLeadBody, @CurrentUser() user: any) {
    const lead = await this.leadsService.create({ ...body, companyId: user.companyId }, user.companyId);
    return { data: lead, message: "Lead created" };
  }

  @Get()
  async findAll(@CurrentUser() user: any) {
    const leads = await this.leadsService.findAll(user.companyId);
    return { data: leads, message: "Leads listed" };
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentUser() user: any) {
    const lead = await this.leadsService.findOne(id, user.companyId);
    return { data: lead, message: "Lead retrieved" };
  }

  @Put(":id")
  async update(@Param("id") id: string, @Body() body: UpdateLeadBody, @CurrentUser() user: any) {
    const lead = await this.leadsService.update(id, body, user.companyId);
    return { data: lead, message: "Lead updated" };
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentUser() user: any) {
    await this.leadsService.remove(id, user.companyId);
    return { message: "Lead deleted" };
  }
}
