import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Inject,
} from "@nestjs/common";
import { IsEmail, IsString, MinLength, IsOptional } from "class-validator";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RateLimit } from "../common/guards/rate-limit.guard";

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  nameAr?: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  commercialRegister?: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

export class LogoutDto {
  @IsString()
  refreshToken!: string;
}

export class AcceptInvitationDto {
  @IsString()
  token!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  nameAr?: string;
}

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post("register")
  @RateLimit({ max: 5, windowSeconds: 300 }) // 5 registrations per 5 minutes
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post("login")
  @RateLimit({ max: 10, windowSeconds: 300 }) // 10 login attempts per 5 minutes
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post("refresh")
  @RateLimit({ max: 30, windowSeconds: 60 }) // 30 refreshes per minute
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: LogoutDto) {
    await this.authService.logout(dto.refreshToken);
    return { message: "Logged out" };
  }

  @Get("invitation/:token")
  @HttpCode(HttpStatus.OK)
  async getInvitation(@Param("token") token: string) {
    return this.authService.getInvitation(token);
  }

  @Post("invitation/accept")
  @RateLimit({ max: 5, windowSeconds: 300 }) // 5 invitation acceptances per 5 minutes
  @HttpCode(HttpStatus.OK)
  async acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.authService.acceptInvitation(dto);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getMe(@Request() req: any) {
    return req.user;
  }

  @Post("me")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async me(@Request() req: any) {
    return req.user;
  }
}
