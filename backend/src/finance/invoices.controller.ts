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
import { InvoicesService } from "./invoices.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

export class CreateInvoiceBody {
  @IsString()
  companyId!: string;

  @IsString()
  invoiceNumber!: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  issueDate?: Date;

  @IsOptional()
  dueDate?: Date;

  @IsOptional()
  subTotal?: number;

  @IsOptional()
  totalTax?: number;

  @IsOptional()
  totalDiscount?: number;

  @IsOptional()
  grandTotal?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  termsAndConditions?: string;

  items?: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate?: number;
    discount?: number;
  }>;
}

export class UpdateInvoiceBody {
  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  issueDate?: Date;

  @IsOptional()
  dueDate?: Date;

  @IsOptional()
  subTotal?: number;

  @IsOptional()
  totalTax?: number;

  @IsOptional()
  totalDiscount?: number;

  @IsOptional()
  grandTotal?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  termsAndConditions?: string;
}

@UseGuards(JwtAuthGuard)
@Controller("finance/invoices")
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  async create(
    @Body() body: CreateInvoiceBody,
    @CurrentUser() user: any,
  ) {
    const invoice = await this.invoicesService.create(
      { ...body, companyId: user.companyId },
      body.items ?? [],
      user.companyId,
    );
    return { data: invoice, message: "Invoice created" };
  }

  @Get()
  async findAll(@CurrentUser() user: any) {
    const invoices = await this.invoicesService.findAll(user.companyId);
    return { data: invoices, message: "Invoices listed" };
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentUser() user: any) {
    const invoice = await this.invoicesService.findOne(id, user.companyId);
    return { data: invoice, message: "Invoice retrieved" };
  }

  @Put(":id")
  async update(@Param("id") id: string, @Body() body: UpdateInvoiceBody, @CurrentUser() user: any) {
    const invoice = await this.invoicesService.update(id, body, user.companyId);
    return { data: invoice, message: "Invoice updated" };
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentUser() user: any) {
    await this.invoicesService.remove(id, user.companyId);
    return { message: "Invoice deleted" };
  }
}
