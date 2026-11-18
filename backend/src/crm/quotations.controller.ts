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
}

export class UpdateQuotationBody {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
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
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("crm/quotations")
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Get()
  @ResponseMessage("Quotations retrieved")
  async findAll(
    @Query("contactId") contactId?: string,
    @Query("dealId") dealId?: string,
    @Query("status") status?: string,
    @CurrentUser() user?: any
  ) {
    return this.quotationsService.findAll(user.companyId, { contactId, dealId, status });
  }

  @Get(":id")
  @ResponseMessage("Quotation retrieved")
  async findOne(@Param("id") id: string, @CurrentUser() user: any) {
    return this.quotationsService.findOne(id, user.companyId);
  }

  @Post()
  @ResponseMessage("Quotation created")
  async create(@Body() body: CreateQuotationBody, @CurrentUser() user: any) {
    return this.quotationsService.create(body, user.companyId, user.userId || user.id);
  }

  @Put(":id")
  @ResponseMessage("Quotation updated")
  async update(
    @Param("id") id: string,
    @Body() body: UpdateQuotationBody,
    @CurrentUser() user: any
  ) {
    return this.quotationsService.update(id, body, user.companyId);
  }

  @Patch(":id")
  @ResponseMessage("Quotation updated")
  async patch(
    @Param("id") id: string,
    @Body() body: UpdateQuotationBody,
    @CurrentUser() user: any
  ) {
    return this.quotationsService.update(id, body, user.companyId);
  }

  @Post(":id/approve")
  @ResponseMessage("Quotation approved")
  async approve(@Param("id") id: string, @CurrentUser() user: any) {
    return this.quotationsService.approve(id, user.companyId, user.userId || user.id);
  }

  @Delete(":id")
  @ResponseMessage("Quotation deleted")
  async remove(@Param("id") id: string, @CurrentUser() user: any) {
    return this.quotationsService.remove(id, user.companyId);
  }
}
