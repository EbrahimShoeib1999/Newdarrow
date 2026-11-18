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
import { NotificationsService } from "./notifications.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ResponseMessage } from "../common/decorators/response-message.decorator";

export class CreateNotificationBody {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsString()
  title!: string;

  @IsString()
  body!: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsBoolean()
  read?: boolean;
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("crm/notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ResponseMessage("Notifications retrieved")
  async findAll(@CurrentUser() user: any) {
    return this.notificationsService.findAll(user.companyId, user.userId);
  }

  @Get("unread-count")
  @ResponseMessage("Unread count retrieved")
  async getUnreadCount(@CurrentUser() user: any) {
    return this.notificationsService.getUnreadCount(user.companyId, user.userId);
  }

  @Post()
  @ResponseMessage("Notification created")
  async create(
    @Body() body: CreateNotificationBody,
    @CurrentUser() user: any
  ) {
    return this.notificationsService.create(body, user.companyId);
  }

  @Post("mark-all-read")
  @ResponseMessage("All notifications marked as read")
  async markAllAsRead(@CurrentUser() user: any) {
    return this.notificationsService.markAllAsRead(user.companyId, user.userId);
  }

  @Patch(":id/read")
  @ResponseMessage("Notification marked as read")
  async markAsReadPatch(
    @Param("id") id: string,
    @CurrentUser() user: any
  ) {
    return this.notificationsService.markAsRead(id, user.companyId, user.userId);
  }

  @Put(":id/read")
  @ResponseMessage("Notification marked as read")
  async markAsReadPut(
    @Param("id") id: string,
    @CurrentUser() user: any
  ) {
    return this.notificationsService.markAsRead(id, user.companyId, user.userId);
  }

  @Delete(":id")
  @ResponseMessage("Notification deleted")
  async remove(@Param("id") id: string, @CurrentUser() user: any) {
    return this.notificationsService.remove(id, user.companyId, user.userId);
  }
}
