import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

export interface CreateQuotationDto {
  title?: string;
  status?: string;
  form: any;
  total?: number;
  currency?: string;
  contactId?: string;
  dealId?: string;
  approvalStatus?: string;
}

export interface UpdateQuotationDto {
  title?: string;
  status?: string;
  form?: any;
  total?: number;
  currency?: string;
  contactId?: string;
  dealId?: string;
  approvalStatus?: string;
}

function calculateQuotationTotal(form: any): number {
  if (!form || !Array.isArray(form.lines)) return 0;
  let subtotal = 0;
  for (const line of form.lines) {
    const qty = Number(line.quantity) || 0;
    const price = Number(line.unitPrice) || 0;
    subtotal += qty * price;
  }
  const vatRate = Number(form.vatRate) || 0;
  const pricesIncludeVat = Boolean(form.pricesIncludeVat);

  if (pricesIncludeVat) {
    return Math.round(subtotal * 100) / 100;
  } else {
    const vat = subtotal * (vatRate / 100);
    return Math.round((subtotal + vat) * 100) / 100;
  }
}

function mapQuotationToResponse(q: any) {
  return {
    id: q.id,
    title: q.title,
    status: q.status || "draft",
    form: q.form,
    total: typeof q.total === "number" ? q.total : Number(q.total) || 0,
    currency: q.currency || "SAR",
    contactId: q.contactId ?? undefined,
    dealId: q.dealId ?? undefined,
    createdBy: q.createdBy ?? undefined,
    approvalStatus: q.approvalStatus || "pending",
    approvedAt: q.approvedAt instanceof Date ? q.approvedAt.toISOString() : q.approvedAt,
    approvedBy: q.approvedBy ?? undefined,
    createdAt: q.createdAt instanceof Date ? q.createdAt.toISOString() : q.createdAt,
    updatedAt: q.updatedAt instanceof Date ? q.updatedAt.toISOString() : q.updatedAt,
  };
}

@Injectable()
export class QuotationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async validateEntityReferences(companyId: string, contactId?: string, dealId?: string) {
    if (contactId) {
      const contact = await this.prisma.customer.findFirst({
        where: { id: contactId, companyId, deletedAt: null },
      });
      if (!contact) {
        throw new BadRequestException("Referenced customer/contact does not exist or does not belong to your company");
      }
    }
    if (dealId) {
      const deal = await this.prisma.deal.findFirst({
        where: { id: dealId, companyId, deletedAt: null },
      });
      if (!deal) {
        throw new BadRequestException("Referenced deal does not exist or does not belong to your company");
      }
    }
  }

  async findAll(companyId: string, filter?: { contactId?: string; dealId?: string; status?: string }) {
    const where: any = {
      companyId,
      deletedAt: null,
    };
    if (filter?.contactId) where.contactId = filter.contactId;
    if (filter?.dealId) where.dealId = filter.dealId;
    if (filter?.status) where.status = filter.status;

    const list = await this.prisma.crmQuotation.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    return list.map(mapQuotationToResponse);
  }

  async findOne(id: string, companyId: string) {
    const quote = await this.prisma.crmQuotation.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!quote) {
      throw new NotFoundException("Quotation not found");
    }
    return mapQuotationToResponse(quote);
  }

  async create(data: CreateQuotationDto, companyId: string, userId: string) {
    const title = data.title?.trim() || "عرض سعر جديد";
    if (!data.form || typeof data.form !== "object") {
      throw new BadRequestException("Quotation form payload is required");
    }

    const contactId = data.contactId || data.form?.selectedContactId || undefined;
    const dealId = data.dealId || undefined;

    await this.validateEntityReferences(companyId, contactId, dealId);

    // Calculate total from lines to prevent client-side manipulation
    const calculatedTotal = calculateQuotationTotal(data.form);
    const total = data.total !== undefined ? Number(data.total) : calculatedTotal;

    const created = await this.prisma.crmQuotation.create({
      data: {
        companyId,
        title,
        status: data.status || "draft",
        form: data.form,
        total,
        currency: data.currency || "SAR",
        contactId: contactId || null,
        dealId: dealId || null,
        createdBy: userId,
        approvalStatus: data.approvalStatus || "pending",
      },
    });

    return mapQuotationToResponse(created);
  }

  async update(id: string, data: UpdateQuotationDto, companyId: string) {
    const existing = await this.prisma.crmQuotation.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException("Quotation not found");
    }

    const contactId = data.contactId !== undefined ? (data.contactId || undefined) : (existing.contactId || undefined);
    const dealId = data.dealId !== undefined ? (data.dealId || undefined) : (existing.dealId || undefined);

    if (data.contactId || data.dealId) {
      await this.validateEntityReferences(companyId, contactId, dealId);
    }

    const updateData: any = {};
    if (data.title !== undefined) updateData.title = data.title.trim();
    if (data.status !== undefined) updateData.status = data.status;
    if (data.form !== undefined) {
      updateData.form = data.form;
      updateData.total = calculateQuotationTotal(data.form);
    } else if (data.total !== undefined) {
      updateData.total = Number(data.total);
    }
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.contactId !== undefined) updateData.contactId = data.contactId || null;
    if (data.dealId !== undefined) updateData.dealId = data.dealId || null;
    if (data.approvalStatus !== undefined) updateData.approvalStatus = data.approvalStatus;

    const updated = await this.prisma.crmQuotation.update({
      where: { id },
      data: updateData,
    });

    return mapQuotationToResponse(updated);
  }

  async approve(id: string, companyId: string, userId: string) {
    const existing = await this.prisma.crmQuotation.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException("Quotation not found");
    }

    const updated = await this.prisma.crmQuotation.update({
      where: { id },
      data: {
        approvalStatus: "approved",
        approvedAt: new Date(),
        approvedBy: userId,
      },
    });

    return mapQuotationToResponse(updated);
  }

  async remove(id: string, companyId: string) {
    const existing = await this.prisma.crmQuotation.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException("Quotation not found");
    }

    await this.prisma.crmQuotation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { success: true };
  }
}
