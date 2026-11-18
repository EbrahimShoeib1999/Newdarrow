import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { IsString, IsOptional, IsBoolean } from "class-validator";
import { ContactClassificationsService } from "./contact-classifications.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ResponseMessage } from "../common/decorators/response-message.decorator";

export class CreateClassificationBody {
  @IsOptional()
  @IsString()
  key?: string;

  @IsString()
  nameAr!: string;

  @IsString()
  nameEn!: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  emoji?: string;
}

export class UpdateClassificationBody {
  @IsOptional()
  @IsString()
  nameAr?: string;

  @IsOptional()
  @IsString()
  nameEn?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  emoji?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

@Controller("crm/contact-classifications")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ContactClassificationsController {
  constructor(
    private readonly classificationsService: ContactClassificationsService
  ) {}

  @Get()
  @ResponseMessage("Classifications loaded successfully")
  async findAll(@CurrentUser() user: { companyId: string }) {
    return this.classificationsService.findAll(user.companyId);
  }

  @Get(":id")
  @ResponseMessage("Classification loaded successfully")
  async findById(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string
  ) {
    return this.classificationsService.findById(user.companyId, id);
  }

  @Post()
  @ResponseMessage("Classification created successfully")
  async create(
    @CurrentUser() user: { companyId: string },
    @Body() body: CreateClassificationBody
  ) {
    return this.classificationsService.create(user.companyId, body);
  }

  @Put(":id")
  @ResponseMessage("Classification updated successfully")
  async update(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string,
    @Body() body: UpdateClassificationBody
  ) {
    return this.classificationsService.update(user.companyId, id, body);
  }

  @Patch(":id")
  @ResponseMessage("Classification updated successfully")
  async patch(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string,
    @Body() body: UpdateClassificationBody
  ) {
    return this.classificationsService.update(user.companyId, id, body);
  }

  @Delete(":id")
  @ResponseMessage("Classification deleted successfully")
  async remove(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string
  ) {
    await this.classificationsService.remove(user.companyId, id);
    return { success: true };
  }
}
