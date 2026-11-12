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
import { CustomersService } from "./customers.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

export class CreateCustomerBody {
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  accountName?: string;

  @IsOptional()
  @IsString()
  legalName?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  whatsappPhone?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  commercialRegister?: string;

  @IsOptional()
  @IsString()
  taxNumber?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;
}

export class UpdateCustomerBody {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  accountName?: string;

  @IsOptional()
  @IsString()
  legalName?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  whatsappPhone?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  commercialRegister?: string;

  @IsOptional()
  @IsString()
  taxNumber?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;
}

@UseGuards(JwtAuthGuard)
@Controller("crm/customers")
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  async create(@Body() body: CreateCustomerBody, @CurrentUser() user: any) {
    const customer = await this.customersService.create(
      { ...body, companyId: user.companyId },
      user.companyId,
    );
    return { data: customer, message: "Customer created" };
  }

  @Get()
  async findAll(@CurrentUser() user: any) {
    const customers = await this.customersService.findAll(user.companyId);
    return { data: customers, message: "Customers listed" };
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentUser() user: any) {
    const customer = await this.customersService.findOne(id, user.companyId);
    return { data: customer, message: "Customer retrieved" };
  }

  @Put(":id")
  async update(@Param("id") id: string, @Body() body: UpdateCustomerBody, @CurrentUser() user: any) {
    const customer = await this.customersService.update(id, body, user.companyId);
    return { data: customer, message: "Customer updated" };
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentUser() user: any) {
    await this.customersService.remove(id, user.companyId);
    return { message: "Customer deleted" };
  }
}
