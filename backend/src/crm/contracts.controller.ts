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
import { IsString, IsOptional, IsBoolean } from "class-validator";
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
  @IsBoolean()
  convertedToTasks?: boolean;

  @IsOptional()
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
  @IsBoolean()
  convertedToTasks?: boolean;

  @IsOptional()
  createdTaskIds?: string[];
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("crm/contracts")
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get()
  @ResponseMessage("Contracts retrieved")
  async findAll(
    @Query("contactId") contactId?: string,
    @Query("dealId") dealId?: string,
    @Query("status") status?: string,
    @CurrentUser() user?: any
  ) {
    return this.contractsService.findAll(user.companyId, { contactId, dealId, status });
  }

  @Get(":id")
  @ResponseMessage("Contract retrieved")
  async findOne(@Param("id") id: string, @CurrentUser() user: any) {
    return this.contractsService.findOne(id, user.companyId);
  }

  @Post()
  @ResponseMessage("Contract created")
  async create(@Body() body: CreateContractBody, @CurrentUser() user: any) {
    return this.contractsService.create(body, user.companyId, user.userId || user.id);
  }

  @Put(":id")
  @ResponseMessage("Contract updated")
  async update(
    @Param("id") id: string,
    @Body() body: UpdateContractBody,
    @CurrentUser() user: any
  ) {
    return this.contractsService.update(id, body, user.companyId);
  }

  @Patch(":id")
  @ResponseMessage("Contract updated")
  async patch(
    @Param("id") id: string,
    @Body() body: UpdateContractBody,
    @CurrentUser() user: any
  ) {
    return this.contractsService.update(id, body, user.companyId);
  }

  @Post(":id/approve")
  @ResponseMessage("Contract approved")
  async approve(@Param("id") id: string, @CurrentUser() user: any) {
    return this.contractsService.approve(id, user.companyId, user.userId || user.id);
  }

  @Delete(":id")
  @ResponseMessage("Contract deleted")
  async remove(@Param("id") id: string, @CurrentUser() user: any) {
    return this.contractsService.remove(id, user.companyId);
  }
}
