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
import { IsString, IsOptional, IsNumber, IsDefined, Allow } from "class-validator";
import { QuotationsService } from "./quotations.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ResponseMessage } from "../common/decorators/response-message.decorator";

export class CreateQuotationBody {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsDefined()
  @Allow()
  form!: any;

  @IsOptional()
  @IsNumber()
  total?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  dealId?: string;

  @IsOptional()
  @IsString()
  approvalStatus?: string;

  @IsOptional()
  @Allow()
  approvedAt?: any;

  @IsOptional()
  @Allow()
  approvedBy?: any;

  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class UpdateQuotationBody {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Allow()
  form?: any;

  @IsOptional()
  @IsNumber()
  total?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  dealId?: string;

  @IsOptional()
  @IsString()
  approvalStatus?: string;

  @IsOptional()
  @Allow()
  approvedAt?: any;

  @IsOptional()
  @Allow()
  approvedBy?: any;

  @IsOptional()
  @IsString()
  createdBy?: string;
}

@Controller("crm/quotations")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Get()
  @ResponseMessage("Quotations fetched successfully")
  async findAll(
    @CurrentUser() user: { companyId: string },
    @Query("contactId") contactId?: string,
    @Query("dealId") dealId?: string,
    @Query("status") status?: string
  ) {
    return this.quotationsService.findAll(user.companyId, {
      contactId,
      dealId,
      status,
    });
  }

  @Get(":id")
  @ResponseMessage("Quotation fetched successfully")
  async findOne(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string
  ) {
    return this.quotationsService.findOne(id, user.companyId);
  }

  @Post()
  @ResponseMessage("Quotation created successfully")
  async create(
    @CurrentUser() user: { companyId: string; sub?: string; id?: string },
    @Body() body: CreateQuotationBody
  ) {
    const userId = user.id || user.sub || "system";
    return this.quotationsService.create(body, user.companyId, userId);
  }

  @Put(":id")
  @ResponseMessage("Quotation updated successfully")
  async update(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string,
    @Body() body: UpdateQuotationBody
  ) {
    return this.quotationsService.update(id, body, user.companyId);
  }

  @Patch(":id")
  @ResponseMessage("Quotation updated successfully")
  async patch(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string,
    @Body() body: UpdateQuotationBody
  ) {
    return this.quotationsService.update(id, body, user.companyId);
  }

  @Delete(":id")
  @ResponseMessage("Quotation deleted successfully")
  async remove(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string
  ) {
    return this.quotationsService.remove(id, user.companyId);
  }
}
