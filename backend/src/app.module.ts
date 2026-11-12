import { Module } from "@nestjs/common";
import { EnvModule } from "./config/env.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { CompaniesModule } from "./companies/companies.module";
import { BranchesModule } from "./branches/branches.module";
import { HrModule } from "./hr/hr.module";
import { CrmModule } from "./crm/crm.module";
import { FinanceModule } from "./finance/finance.module";

@Module({
  imports: [
    EnvModule,
    HealthModule,
    AuthModule,
    CompaniesModule,
    BranchesModule,
    HrModule,
    CrmModule,
    FinanceModule,
  ],
})
export class AppModule {}
