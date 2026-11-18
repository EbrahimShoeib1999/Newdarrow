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
import { IsString, IsOptional, IsBoolean, IsDefined, Allow, IsArray } from "class-validator";
import { ContractsService } from "./contracts.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ResponseMessage } from "../common/decorators/response-message.decorator";

export class CreateContractBody {
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

  @IsOptional()
  @IsBoolean()
  convertedToTasks?: boolean;

  @IsOptional()
  @IsArray()
  createdTaskIds?: string[];
}

export class UpdateContractBody {
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

  @IsOptional()
  @IsBoolean()
  convertedToTasks?: boolean;

  @IsOptional()
  @IsArray()
  createdTaskIds?: string[];
}

@Controller("crm/contracts")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get()
  @ResponseMessage("Contracts fetched successfully")
  async findAll(
    @CurrentUser() user: { companyId: string },
    @Query("contactId") contactId?: string,
    @Query("dealId") dealId?: string,
    @Query("status") status?: string
  ) {
    return this.contractsService.findAll(user.companyId, {
      contactId,
      dealId,
      status,
    });
  }

  @Get(":id")
  @ResponseMessage("Contract fetched successfully")
  async findOne(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string
  ) {
    return this.contractsService.findOne(id, user.companyId);
  }

  @Post()
  @ResponseMessage("Contract created successfully")
  async create(
    @CurrentUser() user: { companyId: string; sub?: string; id?: string },
    @Body() body: CreateContractBody
  ) {
    const userId = user.id || user.sub || "system";
    return this.contractsService.create(body, user.companyId, userId);
  }

  @Put(":id")
  @ResponseMessage("Contract updated successfully")
  async update(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string,
    @Body() body: UpdateContractBody
  ) {
    return this.contractsService.update(id, body, user.companyId);
  }

  @Patch(":id")
  @ResponseMessage("Contract updated successfully")
  async patch(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string,
    @Body() body: UpdateContractBody
  ) {
    return this.contractsService.update(id, body, user.companyId);
  }

  @Delete(":id")
  @ResponseMessage("Contract deleted successfully")
  async remove(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string
  ) {
    return this.contractsService.remove(id, user.companyId);
  }
}
