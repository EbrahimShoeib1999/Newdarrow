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
import { DealsService } from "./deals.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

export class CreateDealBody {
  @IsString()
  companyId!: string;

  @IsString()
  title!: string;

  @IsString()
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  stage?: string;

  @IsOptional()
  probability?: number;

  @IsOptional()
  expectedCloseDate?: Date;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  leadId?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;
}

export class UpdateDealBody {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  amount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  stage?: string;

  @IsOptional()
  probability?: number;

  @IsOptional()
  expectedCloseDate?: Date;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  leadId?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;
}

@UseGuards(JwtAuthGuard)
@Controller("crm/deals")
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  @Post()
  async create(@Body() body: CreateDealBody, @CurrentUser() user: any) {
    const deal = await this.dealsService.create({ ...body, companyId: user.companyId }, user.companyId);
    return { data: deal, message: "Deal created" };
  }

  @Get()
  async findAll(@CurrentUser() user: any) {
    const deals = await this.dealsService.findAll(user.companyId);
    return { data: deals, message: "Deals listed" };
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentUser() user: any) {
    const deal = await this.dealsService.findOne(id, user.companyId);
    return { data: deal, message: "Deal retrieved" };
  }

  @Put(":id")
  async update(@Param("id") id: string, @Body() body: UpdateDealBody, @CurrentUser() user: any) {
    const deal = await this.dealsService.update(id, body, user.companyId);
    return { data: deal, message: "Deal updated" };
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentUser() user: any) {
    await this.dealsService.remove(id, user.companyId);
    return { message: "Deal deleted" };
  }
}
