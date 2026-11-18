import { Injectable, UnauthorizedException, Inject } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../../common/prisma.service";

export interface JwtPayload {
  userId: string;
  email: string;
  role?: string;
  companyId?: string;
}

import { loadEnv } from "../../config/env";
const env = loadEnv();

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: env.JWT_SECRET,
      passReqToCallback: false,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        name: true,
        nameAr: true,
        isPlatformAdmin: true,
        deletedAt: true,
      },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException("User not found or deactivated");
    }

    let role = payload.role;
    let companyId = payload.companyId;

    if (!user.isPlatformAdmin) {
      const membership = await this.prisma.companyMembership.findUnique({
        where: { userId: user.id },
        include: { company: true },
      });

      if (!membership || membership.status !== "ACTIVE") {
        throw new UnauthorizedException("Account has no active company membership");
      }

      if (!membership.company || membership.company.deletedAt) {
        throw new UnauthorizedException("Company is inactive or deleted");
      }

      role = membership.role;
      companyId = membership.companyId;
    }

    return {
      id: user.id,
      userId: user.id,
      email: user.email,
      name: user.name,
      nameAr: user.nameAr,
      role,
      companyId,
      isPlatformAdmin: user.isPlatformAdmin,
    };
  }
}
