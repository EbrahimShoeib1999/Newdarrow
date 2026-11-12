import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { PrismaService } from "../common/prisma.service";
import { loadEnv } from "../config/env";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";

const env = loadEnv();

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: env.JWT_SECRET,
        signOptions: { expiresIn: `${env.JWT_ACCESS_TTL_SECONDS}s` },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PrismaService, JwtStrategy, RateLimitGuard],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
