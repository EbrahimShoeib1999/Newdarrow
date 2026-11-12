import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { PrismaService } from "../common/prisma.service";
import { loadEnv } from "../config/env";
const env = loadEnv();
import { RoleSlug } from "@prisma/client";

export interface JwtPayload {
  userId: string;
  email: string;
  role?: string;
  companyId?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async register(data: {
    email: string;
    password: string;
    name: string;
    nameAr?: string;
    companyName?: string;
    commercialRegister?: string;
  }) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      throw new ConflictException("Email already registered");
    }

    const passwordHash = await this.hashPassword(data.password);

    const user = await this.prisma.user.create({
      data: {
        id: uuidv4(),
        email: data.email,
        passwordHash,
        name: data.name,
        nameAr: data.nameAr ?? "",
        isPlatformAdmin: false,
        onboardingStatus: "pending",
      },
    });

    // If companyName is provided, create a company and make the user an admin member
    if (data.companyName) {
      const slug = data.companyName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 16) || "company";
      const company = await this.prisma.company.create({
        data: {
          id: `${slug}-${user.id.slice(0, 8)}`,
          name: data.companyName,
          defaultCurrency: "SAR",
          settings: {},
          ownerId: user.id,
        },
      });

      await this.prisma.companyMembership.create({
        data: {
          userId: user.id,
          companyId: company.id,
          role: "ADMIN",
          joinedAt: new Date(),
          status: "ACTIVE",
        },
      });
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      nameAr: user.nameAr,
    };
  }

  async login(data: { email: string; password: string }): Promise<TokenPair & { user: any }> {
    const user = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const valid = await this.verifyPassword(data.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    return this.generateTokens(user);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    // Revoke the used refresh token (rotation)
    await this.prisma.refreshToken.delete({ where: { id: stored.id } });

    return this.generateTokens(stored.user);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  }

  async acceptInvitation(data: {
    token: string;
    email: string;
    password: string;
    name: string;
    nameAr?: string;
  }) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: data.token },
      include: { company: true },
    });

    if (!invitation) {
      throw new BadRequestException("Invalid invitation token");
    }
    if (invitation.status !== "PENDING") {
      throw new BadRequestException("Invitation already used or revoked");
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException("Invitation has expired");
    }
    if (invitation.email.toLowerCase() !== data.email.toLowerCase()) {
      throw new BadRequestException("Invitation email does not match");
    }

    // Check if user already exists
    let user = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (!user) {
      const passwordHash = await this.hashPassword(data.password);
      user = await this.prisma.user.create({
        data: {
          id: uuidv4(),
          email: data.email,
          passwordHash,
          name: data.name,
          nameAr: data.nameAr ?? "",
          isPlatformAdmin: false,
          onboardingStatus: "active",
        },
      });
    }

    // Create membership
    await this.prisma.companyMembership.create({
      data: {
        userId: user.id,
        companyId: invitation.companyId,
        role: invitation.role,
        invitedByUserId: invitation.invitedByUserId,
        joinedAt: new Date(),
        status: "ACTIVE",
      },
    });

    // Mark invitation as accepted
    await this.prisma.invitation.update({
      where: { id: data.token },
      data: { status: "ACCEPTED", acceptedByUserId: user.id, updatedAt: new Date() },
    });

    return this.generateTokens(user);
  }

  private async generateTokens(user: any): Promise<TokenPair & { user: any }> {
    const membership = await this.prisma.companyMembership.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
      include: { company: true },
    });

    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: membership?.role,
      companyId: membership?.companyId,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshTokenValue = uuidv4();

    const refreshTtl = env.JWT_REFRESH_TTL_SECONDS;
    await this.prisma.refreshToken.create({
      data: {
        token: refreshTokenValue,
        userId: user.id,
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        nameAr: user.nameAr,
        role: membership?.role,
        companyId: membership?.companyId,
        companyName: membership?.company?.name,
      },
    };
  }
}
