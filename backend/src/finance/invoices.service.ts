import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

export class CreateInvoiceDto {
  companyId!: string;
  invoiceNumber!: string;
  status?: string;
  customerId?: string;
  customerName?: string;
  issueDate?: Date;
  dueDate?: Date;
  subTotal?: number;
  totalTax?: number;
  totalDiscount?: number;
  grandTotal?: number;
  currency?: string;
  notes?: string;
  termsAndConditions?: string;
}

export class CreateInvoiceItemDto {
  description!: string;
  quantity!: number;
  unitPrice!: number;
  taxRate?: number;
  discount?: number;
}

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateInvoiceDto, items: CreateInvoiceItemDto[], requestingUserCompanyId: string) {
    // The user can only create invoices in their own company
    if (data.companyId !== requestingUserCompanyId) {
      throw new ForbiddenException("Cannot create an invoice in a company you are not a member of");
    }

    const company = await this.prisma.company.findUnique({
      where: { id: data.companyId, deletedAt: null },
    });
    if (!company) {
      throw new NotFoundException("Company not found");
    }

    if (data.customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: data.customerId, companyId: data.companyId },
      });
      if (!customer || customer.deletedAt) {
        throw new NotFoundException("Customer not found");
      }
    }

    return this.prisma.invoice.create({
      data: {
        companyId: data.companyId,
        invoiceNumber: data.invoiceNumber,
        status: (data.status as any) ?? "DRAFT",
        customerId: data.customerId ?? null,
        customerName: data.customerName ?? null,
        issueDate: data.issueDate ?? new Date(),
        dueDate: data.dueDate ?? new Date(),
        subTotal: data.subTotal ?? 0,
        totalTax: data.totalTax ?? 0,
        totalDiscount: data.totalDiscount ?? 0,
        grandTotal: data.grandTotal ?? 0,
        amountPaid: 0,
        currency: data.currency ?? "SAR",
        notes: data.notes ?? null,
        termsAndConditions: data.termsAndConditions ?? null,
        items: {
          create: items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate ?? 0,
            discount: item.discount ?? 0,
            total: item.quantity * item.unitPrice,
          })),
        },
      },
      include: { items: true, customer: true },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.invoice.findMany({
      where: { companyId, deletedAt: null },
      include: { items: true, customer: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string, companyId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, companyId },
      include: { items: true, customer: true },
    });
    if (!invoice || invoice.deletedAt) {
      throw new NotFoundException("Invoice not found");
    }
    return invoice;
  }

  async update(id: string, data: Partial<CreateInvoiceDto>, companyId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, companyId },
    });
    if (!invoice || invoice.deletedAt) {
      throw new NotFoundException("Invoice not found");
    }

    return this.prisma.invoice.update({
      where: { id },
      data: {
        ...(data.invoiceNumber !== undefined && { invoiceNumber: data.invoiceNumber }),
        ...(data.status !== undefined && { status: data.status as any }),
        ...(data.customerId !== undefined && { customerId: data.customerId }),
        ...(data.customerName !== undefined && { customerName: data.customerName }),
        ...(data.issueDate !== undefined && { issueDate: data.issueDate }),
        ...(data.dueDate !== undefined && { dueDate: data.dueDate }),
        ...(data.subTotal !== undefined && { subTotal: data.subTotal }),
        ...(data.totalTax !== undefined && { totalTax: data.totalTax }),
        ...(data.totalDiscount !== undefined && { totalDiscount: data.totalDiscount }),
        ...(data.grandTotal !== undefined && { grandTotal: data.grandTotal }),
        ...(data.currency !== undefined && { currency: data.currency }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.termsAndConditions !== undefined && { termsAndConditions: data.termsAndConditions }),
      },
    });
  }

  async remove(id: string, companyId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, companyId },
    });
    if (!invoice || invoice.deletedAt) {
      throw new NotFoundException("Invoice not found");
    }

    return this.prisma.invoice.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
