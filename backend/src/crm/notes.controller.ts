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
import { IsString, IsOptional } from "class-validator";
import { NotesService } from "./notes.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ResponseMessage } from "../common/decorators/response-message.decorator";

export class CreateNoteBody {
  @IsString()
  content!: string;

  @IsString()
  entityType!: string;

  @IsString()
  entityId!: string;

  @IsOptional()
  @IsString()
  authorId?: string;
}

export class UpdateNoteBody {
  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;
}

@Controller("crm/notes")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Get()
  @ResponseMessage("Notes fetched successfully")
  async findAll(
    @CurrentUser() user: { companyId: string },
    @Query("entityType") entityType?: string,
    @Query("entityId") entityId?: string,
    @Query("authorId") authorId?: string
  ) {
    return this.notesService.findAll(user.companyId, {
      entityType,
      entityId,
      authorId,
    });
  }

  @Get(":id")
  @ResponseMessage("Note fetched successfully")
  async findById(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string
  ) {
    return this.notesService.findById(user.companyId, id);
  }

  @Post()
  @ResponseMessage("Note created successfully")
  async create(
    @CurrentUser() user: { companyId: string; sub?: string; id?: string },
    @Body() body: CreateNoteBody
  ) {
    const userId = user.id || user.sub || "system";
    return this.notesService.create(user.companyId, userId, body);
  }

  @Put(":id")
  @ResponseMessage("Note updated successfully")
  async update(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string,
    @Body() body: UpdateNoteBody
  ) {
    return this.notesService.update(user.companyId, id, body);
  }

  @Patch(":id")
  @ResponseMessage("Note updated successfully")
  async patch(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string,
    @Body() body: UpdateNoteBody
  ) {
    return this.notesService.update(user.companyId, id, body);
  }

  @Delete(":id")
  @ResponseMessage("Note deleted successfully")
  async remove(
    @CurrentUser() user: { companyId: string },
    @Param("id") id: string
  ) {
    await this.notesService.remove(user.companyId, id);
    return { success: true };
  }
}
