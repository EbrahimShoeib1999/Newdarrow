import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { IsString, IsOptional, IsNumber } from "class-validator";
import { DealsService } from "./deals.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ResponseMessage } from "../common/decorators/response-message.decorator";

export class CreateDealBody {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  stage?: string;

  @IsOptional()
  @IsNumber()
  probability?: number;

  @IsOptional()
  expectedCloseDate?: string | Date | null;

  @IsOptional()
  @IsString()
  contactId?: string | null;

  @IsOptional()
  @IsString()
  leadId?: string | null;

  @IsOptional()
  @IsString()
  assignedToId?: string | null;

  @IsOptional()
  @IsString()
  assignedTo?: string | null;

  @IsOptional()
  ownerId?: string | null;

  @IsOptional()
  tags?: any;
}

export class UpdateDealBody {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  stage?: string;

  @IsOptional()
  @IsNumber()
  probability?: number;

  @IsOptional()
  expectedCloseDate?: string | Date | null;

  @IsOptional()
  @IsString()
  contactId?: string | null;

  @IsOptional()
  @IsString()
  leadId?: string | null;

  @IsOptional()
  @IsString()
  assignedToId?: string | null;

  @IsOptional()
  @IsString()
  assignedTo?: string | null;

  @IsOptional()
  ownerId?: string | null;

  @IsOptional()
  tags?: any;
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("crm/deals")
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  @Post()
  @ResponseMessage("Deal created")
  async create(@Body() body: CreateDealBody, @CurrentUser() user: any) {
    return this.dealsService.create(
      { ...body, companyId: user.companyId },
      user.companyId
    );
  }

  @Get()
  @ResponseMessage("Deals listed")
  async findAll(@CurrentUser() user: any) {
    return this.dealsService.findAll(user.companyId);
  }

  @Get(":id")
  @ResponseMessage("Deal retrieved")
  async findOne(@Param("id") id: string, @CurrentUser() user: any) {
    return this.dealsService.findOne(id, user.companyId);
  }

  @Put(":id")
  @ResponseMessage("Deal updated")
  async update(
    @Param("id") id: string,
    @Body() body: UpdateDealBody,
    @CurrentUser() user: any
  ) {
    return this.dealsService.update(id, body, user.companyId);
  }

  @Patch(":id")
  @ResponseMessage("Deal updated")
  async patch(
    @Param("id") id: string,
    @Body() body: UpdateDealBody,
    @CurrentUser() user: any
  ) {
    return this.dealsService.update(id, body, user.companyId);
  }

  @Delete(":id")
  @RequirePermission("crm.delete")
  @ResponseMessage("Deal deleted")
  async remove(@Param("id") id: string, @CurrentUser() user: any) {
    await this.dealsService.remove(id, user.companyId);
    return { removed: true };
  }
}
