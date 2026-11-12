import { applyDecorators, UseGuards, SetMetadata } from "@nestjs/common";
import { JwtAuthGuard } from "../guards/jwt-auth.guard";
import { PermissionsGuard } from "../guards/permissions.guard";
import { PERMISSIONS_KEY } from "./require-permission.decorator";

export const RequireAuth = () => UseGuards(JwtAuthGuard);

export const RequirePermissions = (...permissions: string[]) =>
  applyDecorators(
    UseGuards(JwtAuthGuard, PermissionsGuard),
    SetMetadata(PERMISSIONS_KEY, permissions),
  );

export { PERMISSIONS_KEY };
