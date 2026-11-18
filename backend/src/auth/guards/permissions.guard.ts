import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  Inject,
  Optional,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS_KEY } from "../decorators/require-permission.decorator";
import { PrismaService } from "../../common/prisma.service";

/**
 * Resolves the tenant company for a request from the authenticated user's
 * unique CompanyMembership. Never trusts client-supplied companyId.
 *
 * The @unique constraint on CompanyMembership.userId guarantees at most one
 * membership row per user, so findUnique({ where: { userId } }) is
 * deterministic and safe.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly reflector: Reflector;

  constructor(
    @Optional() reflector?: Reflector,
    @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {
    this.reflector = reflector || new Reflector();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.get<string[]>(
      PERMISSIONS_KEY,
      context.getHandler(),
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException("Authentication required");
    }

    // Platform admins have all permissions — separate platform-level access model,
    // not a normal employee membership in multiple companies.
    if (user.isPlatformAdmin) {
      return true;
    }

    // Resolve company context deterministically by unique userId.
    const prisma = this.prisma || new PrismaService();
    const membership = await prisma.companyMembership.findUnique({
      where: { userId: user.userId },
      include: { company: true },
    });

    if (!membership) {
      throw new ForbiddenException("Account has no company membership");
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

    // Attach resolved company context to the request for downstream use.
    // Services must not trust client-supplied companyId; this is the authoritative value.
    request.companyId = membership.companyId;
    request.role = membership.role;

    // Get all permissions for the user's role
    const rolePermissions = await prisma.rolePermission.findMany({
      where: { role: membership.role },
      include: { permission: true },
    });

    const userPermissions = rolePermissions.map((rp) => rp.permission.atom);

    // Check if user has all required permissions
    const missing = requiredPermissions.filter((p) => !userPermissions.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permissions: ${missing.join(", ")}`);
    }

    return true;
  }
}
