import { Module } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { LeadsController } from "./leads.controller";
import { LeadsService } from "./leads.service";
import { DealsController } from "./deals.controller";
import { DealsService } from "./deals.service";
import { ActivitiesController } from "./activities.controller";
import { ActivitiesService } from "./activities.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { PermissionsGuard } from "../auth/guards/permissions.guard";

@Module({
  controllers: [
    CustomersController,
    LeadsController,
    DealsController,
    ActivitiesController,
    NotificationsController,
  ],
  providers: [
    CustomersService,
    PrismaService,
    LeadsService,
    DealsService,
    ActivitiesService,
    NotificationsService,
    PermissionsGuard,
  ],
  exports: [
    CustomersService,
    LeadsService,
    DealsService,
    ActivitiesService,
    NotificationsService,
  ],
})
export class CrmModule {}
