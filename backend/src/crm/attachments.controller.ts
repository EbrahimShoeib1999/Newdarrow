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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { IsString, IsOptional, IsNumber } from "class-validator";
import { AttachmentsService } from "./attachments.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ResponseMessage } from "../common/decorators/response-message.decorator";

export class CreateAttachmentBody {
  @IsString()
  entityType!: string;

  @IsString()
  entityId!: string;

  @IsString()
  fileName!: string;

  @IsString()
  fileUrl!: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsNumber()
  sizeBytes?: number;

  @IsOptional()
  @IsString()
  storageKey?: string;

  @IsOptional()
  @IsString()
  uploadedBy?: string;
}

export class UpdateAttachmentBody {
  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  fileUrl?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsNumber()
  sizeBytes?: number;

  @IsOptional()
  @IsString()
  storageKey?: string;
}

export class UploadAttachmentBody {
  @IsString()
  entityType!: string;

  @IsString()
  entityId!: string;
}

@Controller("crm/attachments")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Get()
  @ResponseMessage("Attachments fetched successfully")
  async findAll(
    @CurrentUser() user: { companyId: string },
    @Query("entityType") entityType?: string,
    @Query("entityId") entityId?: string,
    @Query("uploadedBy") uploadedBy?: string
  ) {
    return this.attachmentsService.findAll(user.companyId, {
      entityType,
      entityId,
      uploadedBy,
    });
  }

  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 10 * 1024 * 1024 },
    })
  )
  @ResponseMessage("Attachment uploaded successfully")
  async upload(
    @CurrentUser() user: { companyId: string; sub?: string; id?: string },
    @Body() body: UploadAttachmentBody,
    @UploadedFile() file: Express.Multer.File
  ) {
    const userId = user.id || user.sub || "system";
    return this.attachmentsService.uploadAttachment(
      user.companyId,
      userId,
      body.entityType,
      body.entityId,
      file
    );
  }

  @Get(":id/content")
  async getContent(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string,
    @Res() res: Response
  ) {
    const content = await this.attachmentsService.getAttachmentContent(user.companyId, id);

    res.set({
      "Content-Type": content.mimeType,
      "Content-Length": content.sizeBytes,
      "Content-Disposition": `inline; filename="${encodeURIComponent(content.fileName)}"`,
      "Cache-Control": "private, max-age=3600",
    });

    if (content.type === "stream" && content.stream) {
      content.stream.pipe(res);
    } else if (content.type === "buffer" && content.buffer) {
      res.end(content.buffer);
    } else {
      res.status(404).end();
    }
  }

  @Get(":id")
  @ResponseMessage("Attachment fetched successfully")
  async findById(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string
  ) {
    return this.attachmentsService.findById(user.companyId, id);
  }

  @Post()
  @ResponseMessage("Attachment created successfully")
  async create(
    @CurrentUser() user: { companyId: string; sub?: string; id?: string },
    @Body() body: CreateAttachmentBody
  ) {
    const userId = user.id || user.sub || "system";
    return this.attachmentsService.create(user.companyId, userId, body);
  }

  @Put(":id")
  @ResponseMessage("Attachment updated successfully")
  async update(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string,
    @Body() body: UpdateAttachmentBody
  ) {
    return this.attachmentsService.update(user.companyId, id, body);
  }

  @Patch(":id")
  @ResponseMessage("Attachment updated successfully")
  async patch(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string,
    @Body() body: UpdateAttachmentBody
  ) {
    return this.attachmentsService.update(user.companyId, id, body);
  }

  @Delete(":id")
  @ResponseMessage("Attachment deleted successfully")
  async remove(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string
  ) {
    await this.attachmentsService.remove(user.companyId, id);
    return { success: true };
  }
}
