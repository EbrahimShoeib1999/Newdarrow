import { Module } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { StorageModule } from "../storage/storage.module";
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
import { ContractsController } from "./contracts.controller";
import { ContractsService } from "./contracts.service";
import { QuotationsController } from "./quotations.controller";
import { QuotationsService } from "./quotations.service";
import { CrmTasksController } from "./crm-tasks.controller";
import { CrmTasksService } from "./crm-tasks.service";
import { NotesController } from "./notes.controller";
import { NotesService } from "./notes.service";
import { AttachmentsController } from "./attachments.controller";
import { AttachmentsService } from "./attachments.service";
import {
  ClientReportsController,
  PublicClientReportsController,
} from "./client-reports.controller";
import { ClientReportsService } from "./client-reports.service";
import { ContactClassificationsController } from "./contact-classifications.controller";
import { ContactClassificationsService } from "./contact-classifications.service";
import { PermissionsGuard } from "../auth/guards/permissions.guard";

@Module({
  imports: [StorageModule],
  controllers: [
    CustomersController,
    LeadsController,
    DealsController,
    ActivitiesController,
    NotificationsController,
    ContractsController,
    QuotationsController,
    CrmTasksController,
    NotesController,
    AttachmentsController,
    ClientReportsController,
    PublicClientReportsController,
    ContactClassificationsController,
  ],
  providers: [
    PrismaService,
    CustomersService,
    LeadsService,
    DealsService,
    ActivitiesService,
    NotificationsService,
    ContractsService,
    QuotationsService,
    CrmTasksService,
    NotesService,
    AttachmentsService,
    ClientReportsService,
    ContactClassificationsService,
    PermissionsGuard,
  ],
  exports: [
    CustomersService,
    LeadsService,
    DealsService,
    ActivitiesService,
    NotificationsService,
    ContractsService,
    QuotationsService,
    CrmTasksService,
    NotesService,
    AttachmentsService,
    ClientReportsService,
    ContactClassificationsService,
  ],
})
export class CrmModule {}
