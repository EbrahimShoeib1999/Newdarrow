import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as crypto from "crypto";
import { PrismaService } from "../common/prisma.service";

export interface CreateClientReportDto {
  contactId: string;
  contactName: string;
  dealId?: string;
  dealTitle?: string;
  title: string;
  description?: string;
  internalNotes?: string;
  reportType?: string;
  content: string;
  keyOutcomes?: string[];
  actionItems?: any[];
  clientMood?: string;
  satisfactionRating?: number;
  status?: string;
}

export interface UpdateClientReportDto {
  contactId?: string;
  contactName?: string;
  dealId?: string;
  dealTitle?: string;
  title?: string;
  description?: string;
  internalNotes?: string;
  reportType?: string;
  content?: string;
  keyOutcomes?: string[];
  actionItems?: any[];
  clientMood?: string;
  satisfactionRating?: number;
  status?: string;
}

function mapReportToResponse(r: any, isPublicView = false) {
  return {
    id: r.id,
    companyId: r.companyId,
    contactId: r.contactId,
    contactName: r.contactName,
    dealId: r.dealId ?? undefined,
    dealTitle: r.dealTitle ?? undefined,
    authorId: r.authorId,
    authorName: r.authorName,
    authorEmail: r.authorEmail ?? undefined,
    title: r.title,
    description: r.description ?? undefined,
    // Sensitive/confidential internal notes are stripped on public view
    internalNotes: isPublicView ? undefined : (r.internalNotes ?? undefined),
    reportType: r.reportType || "general",
    content: r.content,
    keyOutcomes: Array.isArray(r.keyOutcomes) ? r.keyOutcomes : [],
    actionItems: Array.isArray(r.actionItems) ? r.actionItems : [],
    clientMood: r.clientMood || "satisfied",
    satisfactionRating: typeof r.satisfactionRating === "number" ? r.satisfactionRating : 5,
    status: r.status || "submitted",
    reviewedBy: r.reviewedBy ?? undefined,
    reviewedByName: r.reviewedByName ?? undefined,
    reviewedAt: r.reviewedAt instanceof Date ? r.reviewedAt.toISOString() : r.reviewedAt ?? undefined,
    publicToken: isPublicView ? undefined : (r.publicToken ?? undefined),
    publicTokenExpiresAt: isPublicView ? undefined : (r.publicTokenExpiresAt instanceof Date ? r.publicTokenExpiresAt.toISOString() : undefined),
    isPublicRevoked: isPublicView ? undefined : Boolean(r.isPublicRevoked),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
  };
}

@Injectable()
export class ClientReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    companyId: string,
    filters?: {
      contactId?: string;
      dealId?: string;
      authorId?: string;
      reportType?: string;
      clientMood?: string;
    }
  ) {
    const where: any = { companyId, deletedAt: null };
    if (filters?.contactId) where.contactId = filters.contactId;
    if (filters?.dealId) where.dealId = filters.dealId;
    if (filters?.authorId) where.authorId = filters.authorId;
    if (filters?.reportType) where.reportType = filters.reportType;
    if (filters?.clientMood) where.clientMood = filters.clientMood;

    const reports = await this.prisma.crmClientReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return reports.map((r) => mapReportToResponse(r, false));
  }

  async findById(companyId: string, id: string) {
    const report = await this.prisma.crmClientReport.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!report) {
      throw new NotFoundException(`Client report with ID ${id} not found`);
    }
    return mapReportToResponse(report, false);
  }

  async create(
    companyId: string,
    author: { id: string; name: string; email?: string },
    dto: CreateClientReportDto
  ) {
    if (!dto.title || !dto.content) {
      throw new BadRequestException("title and content are required");
    }

    const report = await this.prisma.crmClientReport.create({
      data: {
        companyId,
        contactId: dto.contactId || "",
        contactName: dto.contactName || "",
        dealId: dto.dealId || null,
        dealTitle: dto.dealTitle || null,
        authorId: author.id,
        authorName: author.name,
        authorEmail: author.email || null,
        title: dto.title,
        description: dto.description || null,
        internalNotes: dto.internalNotes || null,
        reportType: dto.reportType || "general",
        content: dto.content,
        keyOutcomes: dto.keyOutcomes || [],
        actionItems: dto.actionItems || [],
        clientMood: dto.clientMood || "satisfied",
        satisfactionRating: typeof dto.satisfactionRating === "number" ? dto.satisfactionRating : 5,
        status: dto.status || "submitted",
      },
    });

    return mapReportToResponse(report, false);
  }

  async update(companyId: string, id: string, dto: UpdateClientReportDto) {
    await this.findById(companyId, id);

    const updateData: any = {};
    if (dto.contactId !== undefined) updateData.contactId = dto.contactId;
    if (dto.contactName !== undefined) updateData.contactName = dto.contactName;
    if (dto.dealId !== undefined) updateData.dealId = dto.dealId || null;
    if (dto.dealTitle !== undefined) updateData.dealTitle = dto.dealTitle || null;
    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.description !== undefined) updateData.description = dto.description || null;
    if (dto.internalNotes !== undefined) updateData.internalNotes = dto.internalNotes || null;
    if (dto.reportType !== undefined) updateData.reportType = dto.reportType;
    if (dto.content !== undefined) updateData.content = dto.content;
    if (dto.keyOutcomes !== undefined) updateData.keyOutcomes = dto.keyOutcomes;
    if (dto.actionItems !== undefined) updateData.actionItems = dto.actionItems;
    if (dto.clientMood !== undefined) updateData.clientMood = dto.clientMood;
    if (dto.satisfactionRating !== undefined) updateData.satisfactionRating = dto.satisfactionRating;
    if (dto.status !== undefined) updateData.status = dto.status;

    const updated = await this.prisma.crmClientReport.update({
      where: { id },
      data: updateData,
    });

    return mapReportToResponse(updated, false);
  }

  async approve(
    companyId: string,
    id: string,
    reviewer: { id: string; name: string }
  ) {
    await this.findById(companyId, id);

    const updated = await this.prisma.crmClientReport.update({
      where: { id },
      data: {
        status: "reviewed",
        reviewedBy: reviewer.id,
        reviewedByName: reviewer.name,
        reviewedAt: new Date(),
      },
    });

    return mapReportToResponse(updated, false);
  }

  async remove(companyId: string, id: string) {
    await this.findById(companyId, id);
    await this.prisma.crmClientReport.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async generatePublicToken(companyId: string, id: string, expiresInDays = 30) {
    await this.findById(companyId, id);

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const updated = await this.prisma.crmClientReport.update({
      where: { id },
      data: {
        publicToken: token,
        publicTokenExpiresAt: expiresAt,
        isPublicRevoked: false,
      },
    });

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      reportId: updated.id,
    };
  }

  async revokePublicToken(companyId: string, id: string) {
    await this.findById(companyId, id);
    await this.prisma.crmClientReport.update({
      where: { id },
      data: {
        isPublicRevoked: true,
      },
    });
    return { success: true };
  }

  // Public methods (No JWT required)
  async findByPublicToken(token: string) {
    if (!token || token.length < 16) {
      throw new BadRequestException("Invalid public token");
    }

    const report = await this.prisma.crmClientReport.findFirst({
      where: {
        publicToken: token,
        deletedAt: null,
      },
    });

    if (!report) {
      throw new NotFoundException("Client report not found or link is invalid");
    }

    if (report.isPublicRevoked) {
      throw new ForbiddenException("Public access to this report has been revoked");
    }

    if (report.publicTokenExpiresAt && new Date() > report.publicTokenExpiresAt) {
      throw new ForbiddenException("Public report link has expired");
    }

    return mapReportToResponse(report, true);
  }

  async findPublicReportById(companyId: string, reportId: string) {
    if (!companyId || !reportId) {
      throw new BadRequestException("companyId and reportId are required");
    }

    const report = await this.prisma.crmClientReport.findFirst({
      where: {
        id: reportId,
        companyId,
        deletedAt: null,
      },
    });

    if (!report) {
      throw new NotFoundException("Client report not found");
    }

    if (report.isPublicRevoked) {
      throw new ForbiddenException("Public access to this report has been revoked");
    }

    if (report.publicTokenExpiresAt && new Date() > report.publicTokenExpiresAt) {
      throw new ForbiddenException("Public report link has expired");
    }

    return mapReportToResponse(report, true);
  }
}
