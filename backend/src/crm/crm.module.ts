import { Module } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { LeadsController } from "./leads.controller";
import { LeadsService } from "./leads.service";
import { DealsController } from "./deals.controller";
import { DealsService } from "./deals.service";

@Module({
  controllers: [CustomersController, LeadsController, DealsController],
  providers: [CustomersService, PrismaService, LeadsService, DealsService],
  exports: [CustomersService, LeadsService, DealsService],
})
export class CrmModule {}
