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
import { EmployeesService } from "./employees.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

export class CreateEmployeeBody {
  @IsString()
  userId!: string;

  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsString()
  employeeNumber!: string;

  @IsString()
  jobTitle!: string;

  @IsOptional()
  @IsString()
  jobTitleAr?: string;

  @IsOptional()
  joiningDate?: Date;

  @IsOptional()
  salary?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  workLocationId?: string;

  @IsOptional()
  requireGps?: boolean;

  @IsOptional()
  mandatoryGps?: boolean;
}

export class UpdateEmployeeBody {
  @IsOptional()
  @IsString()
  jobTitle?: string;

  @IsOptional()
  @IsString()
  jobTitleAr?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  employmentStatus?: string;

  @IsOptional()
  salary?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;
}

@UseGuards(JwtAuthGuard)
@Controller("hr/employees")
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  async create(@Body() body: CreateEmployeeBody, @CurrentUser() user: any) {
    const employee = await this.employeesService.create({ ...body, companyId: user.companyId }, user.companyId);
    return { data: employee, message: "Employee created" };
  }

  @Get()
  async findAll(@CurrentUser() user: any) {
    const employees = await this.employeesService.findAll(user.companyId);
    return { data: employees, message: "Employees listed" };
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentUser() user: any) {
    const employee = await this.employeesService.findOne(id, user.companyId);
    return { data: employee, message: "Employee retrieved" };
  }

  @Put(":id")
  async update(@Param("id") id: string, @Body() body: UpdateEmployeeBody, @CurrentUser() user: any) {
    const employee = await this.employeesService.update(id, body, user.companyId);
    return { data: employee, message: "Employee updated" };
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentUser() user: any) {
    await this.employeesService.remove(id, user.companyId);
    return { message: "Employee deleted" };
  }
}
