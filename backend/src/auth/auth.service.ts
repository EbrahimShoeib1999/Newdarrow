import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma, PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { PrismaService } from "../common/prisma.service";
import { loadEnv } from "../config/env";
const env = loadEnv();

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
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwtService: JwtService,
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

    // If companyName is provided, create a company and make the user an admin member.
    // This is the only path that creates a membership during registration, so a
    // registered account has exactly zero or one membership — never more.
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
    const user = await this.prisma.$transaction(async (tx) => {
      const stored = await tx.refreshToken.findUnique({
        where: { token: refreshToken },
        include: { user: true },
      });

      if (!stored || stored.expiresAt < new Date()) {
        throw new UnauthorizedException("Invalid or expired refresh token");
      }

      // Atomically consume (delete) the refresh token inside the transaction
      // to eliminate concurrent reuse race conditions.
      const deleted = await tx.refreshToken.deleteMany({ where: { id: stored.id } });
      if (deleted.count === 0) {
        throw new UnauthorizedException("Invalid or expired refresh token");
      }

      return stored.user;
    });

    return this.generateTokens(user);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  }

  async getInvitation(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: token },
    });

    if (!invitation) {
      throw new NotFoundException("Invalid invitation token");
    }

    if (invitation.status !== "PENDING") {
      throw new BadRequestException("Invitation already used or revoked");
    }

    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException("Invitation has expired");
    }

    return {
      id: invitation.id,
      token: invitation.id,
      email: invitation.email,
      role: invitation.role,
      companyId: invitation.companyId,
      companyName: invitation.companyName,
      invitedBy: invitation.invitedByUserId,
      invitedByName: invitation.invitedByName,
      status: invitation.status.toLowerCase(),
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    };
  }

  async acceptInvitation(data: {
    token: string;
    email: string;
    password: string;
    name: string;
    nameAr?: string;
  }) {
    const normalizedEmail = data.email.toLowerCase();

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const invitation = await tx.invitation.findUnique({
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
        if (invitation.email.toLowerCase() !== normalizedEmail) {
          throw new BadRequestException("Invitation email does not match");
        }

        // Check if user already exists
        let user = await tx.user.findUnique({ where: { email: normalizedEmail } });

        if (user) {
          // Existing user: they must not already have a company membership.
          // The unique userId constraint is the final database safety boundary.
          const existingMembership = await tx.companyMembership.findUnique({
            where: { userId: user.id },
          });
          if (existingMembership) {
            throw new ForbiddenException("Account already belongs to a company");
          }
        } else {
          const passwordHash = await this.hashPassword(data.password);
          user = await tx.user.create({
            data: {
              id: uuidv4(),
              email: normalizedEmail,
              passwordHash,
              name: data.name,
              nameAr: data.nameAr ?? "",
              isPlatformAdmin: false,
              onboardingStatus: "active",
            },
          });
        }

        // Create the one membership for this account in the invited company.
        await tx.companyMembership.create({
          data: {
            userId: user.id,
            companyId: invitation.companyId,
            role: invitation.role,
            invitedByUserId: invitation.invitedByUserId,
            joinedAt: new Date(),
            status: "ACTIVE",
          },
        });

        // Mark invitation as accepted only after membership creation succeeds.
        await tx.invitation.update({
          where: { id: data.token },
          data: { status: "ACCEPTED", acceptedByUserId: user.id, updatedAt: new Date() },
        });

        return user;
      });

      return this.generateTokens(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const target = error.meta?.target;
        const fields = Array.isArray(target) ? target : typeof target === "string" ? [target] : [];
        if (fields.includes("userId")) {
          throw new ForbiddenException("Account already belongs to a company");
        }
        throw new BadRequestException("Invitation could not be accepted");
      }
      throw error;
    }
  }

  private async generateTokens(user: any): Promise<TokenPair & { user: any }> {
    // Resolve membership deterministically by unique userId (not findFirst).
    // The @unique constraint on CompanyMembership.userId guarantees at most one row.
    const membership = await this.prisma.companyMembership.findUnique({
      where: { userId: user.id },
      include: { company: true },
    });

    if (!membership) {
      throw new ForbiddenException("Account has no active company membership");
    }

    if (membership.status !== "ACTIVE") {
      throw new ForbiddenException(`Membership is ${membership.status}`);
    }

    if (!membership.company || membership.company.deletedAt) {
      throw new ForbiddenException("Company is inactive or deleted");
    }

    if (user.deletedAt) {
      throw new ForbiddenException("Account is deactivated");
    }

    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: membership.role,
      companyId: membership.companyId,
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
        role: membership.role,
        companyId: membership.companyId,
        companyName: membership.company.name,
      },
    };
  }
}
