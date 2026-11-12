import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS_KEY } from "../decorators/require-permission.decorator";
import { PrismaService } from "../../common/prisma.service";

/**
 * Resolves the tenant companyId for a request from multiple sources:
 * 1. Body params (companyId)
 * 2. Query params (companyId)
 * 3. Path params (companyId)
 * 4. The user's active membership (fallback)
 *
 * Never trusts client-supplied companyId for authorization — the user's
 * actual membership is verified against the database.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

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

    // Platform admins have all permissions
    if (user.isPlatformAdmin) {
      return true;
    }

    // Resolve company context: prefer user's active membership
    const membership = await this.prisma.companyMembership.findFirst({
      where: { userId: user.userId, status: "ACTIVE" },
    });

    if (!membership) {
      throw new ForbiddenException("No active company membership");
    }

    // Attach resolved company context to the request for downstream use
    request.companyId = membership.companyId;
    request.role = membership.role;

    // Get all permissions for the user's role
    const rolePermissions = await this.prisma.rolePermission.findMany({
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
