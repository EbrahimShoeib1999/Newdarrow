import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
  ForbiddenException,
} from "@nestjs/common";
import { IsString, IsOptional } from "class-validator";
import { BranchesService } from "./branches.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";

export class CreateBranchBody {
  @IsString()
  companyId!: string;

  @IsString()
  name!: string;
}

export class UpdateBranchBody {
  @IsOptional()
  @IsString()
  name?: string;
}

@UseGuards(JwtAuthGuard)
@Controller("branches")
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Post()
  async create(@Body() body: CreateBranchBody, @CurrentUser() user: any) {
    const branch = await this.branchesService.create(body, user.companyId);
    return { data: branch, message: "Branch created" };
  }

  @Get("company/:companyId")
  async findAll(@Param("companyId") companyId: string, @CurrentUser() user: any) {
    // Only allow listing branches of the user's own company
    if (companyId !== user.companyId) {
      throw new ForbiddenException("Cannot view branches of another company");
    }
    const branches = await this.branchesService.findAll(companyId);
    return { data: branches, message: "Branches listed" };
  }

  @Get(":id")
  async findOne(@Param("id") id: string, @CurrentUser() user: any) {
    const branch = await this.branchesService.findOne(id, user.companyId);
    return { data: branch, message: "Branch retrieved" };
  }

  @Put(":id")
  async update(
    @Param("id") id: string,
    @Body() body: UpdateBranchBody,
    @CurrentUser() user: any,
  ) {
    const branch = await this.branchesService.update(id, body, user.companyId);
    return { data: branch, message: "Branch updated" };
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentUser() user: any) {
    await this.branchesService.remove(id, user.companyId);
    return { message: "Branch deleted" };
  }
}
