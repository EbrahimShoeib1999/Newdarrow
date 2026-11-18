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
import { CustomersService } from "./customers.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ResponseMessage } from "../common/decorators/response-message.decorator";

export class CreateCustomerBody {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  fullName?: string;

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

  @IsOptional()
  @IsString()
  assignedTo?: string;
}

export class UpdateCustomerBody {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  fullName?: string;

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

  @IsOptional()
  @IsString()
  assignedTo?: string;
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("crm/customers")
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @ResponseMessage("Customer created")
  async create(@Body() body: CreateCustomerBody, @CurrentUser() user: any) {
    return this.customersService.create(
      { ...body, companyId: user.companyId },
      user.companyId,
    );
  }

  @Get()
  @ResponseMessage("Customers listed")
  async findAll(@CurrentUser() user: any) {
    return this.customersService.findAll(user.companyId);
  }

  @Get(":id")
  @ResponseMessage("Customer retrieved")
  async findOne(@Param("id") id: string, @CurrentUser() user: any) {
    return this.customersService.findOne(id, user.companyId);
  }

  @Put(":id")
  @ResponseMessage("Customer updated")
  async update(@Param("id") id: string, @Body() body: UpdateCustomerBody, @CurrentUser() user: any) {
    return this.customersService.update(id, body, user.companyId);
  }

  @Delete(":id")
  @RequirePermission("crm.delete")
  @ResponseMessage("Customer deleted")
  async remove(@Param("id") id: string, @CurrentUser() user: any) {
    await this.customersService.remove(id, user.companyId);
    return { removed: true };
  }
}
