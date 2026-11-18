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
import { IsString, IsOptional, IsNumber, IsArray } from "class-validator";
import { ClientReportsService } from "./client-reports.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ResponseMessage } from "../common/decorators/response-message.decorator";
import { RateLimit } from "../common/guards/rate-limit.guard";

export class CreateClientReportBody {
  @IsString()
  contactId!: string;

  @IsString()
  contactName!: string;

  @IsOptional()
  @IsString()
  dealId?: string;

  @IsOptional()
  @IsString()
  dealTitle?: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  internalNotes?: string;

  @IsOptional()
  @IsString()
  reportType?: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsArray()
  keyOutcomes?: string[];

  @IsOptional()
  @IsArray()
  actionItems?: any[];

  @IsOptional()
  @IsString()
  clientMood?: string;

  @IsOptional()
  @IsNumber()
  satisfactionRating?: number;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateClientReportBody {
  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  dealId?: string;

  @IsOptional()
  @IsString()
  dealTitle?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  internalNotes?: string;

  @IsOptional()
  @IsString()
  reportType?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsArray()
  keyOutcomes?: string[];

  @IsOptional()
  @IsArray()
  actionItems?: any[];

  @IsOptional()
  @IsString()
  clientMood?: string;

  @IsOptional()
  @IsNumber()
  satisfactionRating?: number;

  @IsOptional()
  @IsString()
  status?: string;
}

@Controller("crm/client-reports")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ClientReportsController {
  constructor(private readonly reportsService: ClientReportsService) {}

  @Get()
  @ResponseMessage("Client reports fetched successfully")
  async findAll(
    @CurrentUser() user: { companyId: string },
    @Query("contactId") contactId?: string,
    @Query("dealId") dealId?: string,
    @Query("authorId") authorId?: string,
    @Query("reportType") reportType?: string,
    @Query("clientMood") clientMood?: string
  ) {
    return this.reportsService.findAll(user.companyId, {
      contactId,
      dealId,
      authorId,
      reportType,
      clientMood,
    });
  }

  @Get(":id")
  @ResponseMessage("Client report fetched successfully")
  async findById(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string
  ) {
    return this.reportsService.findById(user.companyId, id);
  }

  @Post()
  @ResponseMessage("Client report created successfully")
  async create(
    @CurrentUser() user: { companyId: string; sub?: string; id?: string; email?: string; name?: string },
    @Body() body: CreateClientReportBody
  ) {
    const author = {
      id: user.id || user.sub || "system",
      name: user.name || "User",
      email: user.email,
    };
    return this.reportsService.create(user.companyId, author, body);
  }

  @Put(":id")
  @ResponseMessage("Client report updated successfully")
  async update(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string,
    @Body() body: UpdateClientReportBody
  ) {
    return this.reportsService.update(user.companyId, id, body);
  }

  @Patch(":id")
  @ResponseMessage("Client report updated successfully")
  async patch(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string,
    @Body() body: UpdateClientReportBody
  ) {
    return this.reportsService.update(user.companyId, id, body);
  }

  @Post(":id/approve")
  @ResponseMessage("Client report approved successfully")
  async approve(
    @CurrentUser() user: { companyId: string; id?: string; sub?: string; name?: string },
    @Param("id") id: string
  ) {
    const reviewer = {
      id: user.id || user.sub || "system",
      name: user.name || "Reviewer",
    };
    return this.reportsService.approve(user.companyId, id, reviewer);
  }

  @Post(":id/share")
  @ResponseMessage("Public link created successfully")
  async generateShareLink(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string,
    @Body("expiresInDays") expiresInDays?: number
  ) {
    return this.reportsService.generatePublicToken(user.companyId, id, expiresInDays);
  }

  @Post(":id/revoke")
  @ResponseMessage("Public link revoked successfully")
  async revokeShareLink(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string
  ) {
    return this.reportsService.revokePublicToken(user.companyId, id);
  }

  @Delete(":id")
  @ResponseMessage("Client report deleted successfully")
  async remove(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string
  ) {
    await this.reportsService.remove(user.companyId, id);
    return { success: true };
  }
}

/**
 * Public controller for anonymous public client report viewing (WP-12).
 * Rate limited to 30 requests per minute.
 */
@Controller("crm/public/client-reports")
export class PublicClientReportsController {
  constructor(private readonly reportsService: ClientReportsService) {}

  @Get(":token")
  @RateLimit({ max: 30, windowSeconds: 60 })
  @ResponseMessage("Public client report loaded")
  async getByToken(@Param("token") token: string) {
    return this.reportsService.findByPublicToken(token);
  }

  @Get("view/:companyId/:reportId")
  @RateLimit({ max: 30, windowSeconds: 60 })
  @ResponseMessage("Public client report loaded")
  async getByCompanyAndId(
    @Param("companyId") companyId: string,
    @Param("reportId") reportId: string
  ) {
    return this.reportsService.findPublicReportById(companyId, reportId);
  }
}
