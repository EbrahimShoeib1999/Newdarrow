import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
  ForbiddenException,
} from "@nestjs/common";
import { IsString, IsOptional } from "class-validator";
import { CompaniesService } from "./companies.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

export class CreateCompanyBody {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  primaryActivity?: string;

  @IsOptional()
  @IsString()
  defaultCurrency?: string;

  @IsOptional()
  settings?: Record<string, unknown>;
}

export class UpdateCompanyBody {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  primaryActivity?: string;

  @IsOptional()
  @IsString()
  defaultCurrency?: string;

  @IsOptional()
  settings?: Record<string, unknown>;
}

@UseGuards(JwtAuthGuard)
@Controller("companies")
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post()
  async create(@Body() body: CreateCompanyBody, @CurrentUser() user: any) {
    const company = await this.companiesService.create(body, user.userId);
    return { data: company, message: "Company created" };
  }

  @Get()
  async findAll(@CurrentUser() user: any) {
    const companies = await this.companiesService.findAll(user.companyId);
    return { data: companies, message: "Companies listed" };
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentUser() user: any) {
    const company = await this.companiesService.findOne(id, user.companyId);
    return { data: company, message: "Company retrieved" };
  }

  @Put(":id")
  async update(
    @Param("id") id: string,
    @Body() body: UpdateCompanyBody,
    @CurrentUser() user: any,
  ) {
    const company = await this.companiesService.update(id, body, user.companyId);
    return { data: company, message: "Company updated" };
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentUser() user: any) {
    await this.companiesService.remove(id, user.companyId);
    return { message: "Company deleted" };
  }

  @Get(":id/memberships")
  async getMemberships(@Param("id") companyId: string, @CurrentUser() user: any) {
    // Only allow viewing memberships of the user's own company
    if (companyId !== user.companyId) {
      throw new ForbiddenException("Cannot view memberships of another company");
    }
    const memberships = await this.companiesService.getMemberships(companyId);
    return { data: memberships, message: "Company memberships retrieved" };
  }
}
