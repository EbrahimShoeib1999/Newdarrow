import type { Contact } from "@/features/crm/types/contacts.types";
import { contactDisplayName } from "@/features/crm/utils/contacts-list.utils";
import type { Invoice } from "../schemas/invoice";
import type { Bill } from "../schemas/bill";

/** Label shown in customer/vendor pickers (person + optional company). */
export function invoiceCustomerPickerLabel(contact: Contact): string {
  const name = contactDisplayName(contact);
  const company = contact.accountName?.trim();
  if (company && company.toLowerCase() !== name.toLowerCase()) {
    return `${name} — ${company}`;
  }
  return company || name;
}

export function resolvePartyName(
  party: { id?: string; name?: string | null },
  contacts: Contact[],
  unknownLabel = "—"
): string {
  const snapshot = party.name?.trim();
  if (snapshot) return snapshot;

  const contact = contacts.find((c) => c.id === party.id);
  if (contact) return invoiceCustomerPickerLabel(contact);

  const id = party.id?.trim();
  if (!id || id.startsWith("cust_") || id.startsWith("vendor_")) {
    return unknownLabel;
  }
  return id;
}

export function resolveInvoiceCustomerName(
  invoice: Pick<Invoice, "customerId" | "customerName">,
  contacts: Contact[],
  unknownLabel = "—"
): string {
  return resolvePartyName(
    { id: invoice.customerId, name: invoice.customerName },
    contacts,
    unknownLabel
  );
}

export function resolveBillVendorName(
  bill: Pick<Bill, "vendorId" | "vendorName">,
  contacts: Contact[],
  unknownLabel = "—"
): string {
  return resolvePartyName(
    { id: bill.vendorId, name: bill.vendorName },
    contacts,
    unknownLabel
  );
}

export function findContactByCustomerInput(
  contacts: Contact[],
  input: string
): Contact | undefined {
  const q = input.trim().toLowerCase();
  if (!q) return undefined;
  return contacts.find((c) => {
    const label = invoiceCustomerPickerLabel(c).toLowerCase();
    const name = contactDisplayName(c).toLowerCase();
    const company = c.accountName?.trim().toLowerCase() ?? "";
    const legalName = c.legalName?.trim().toLowerCase() ?? "";
    const fullName = c.fullName?.trim().toLowerCase() ?? "";
    const email = c.email?.trim().toLowerCase() ?? "";
    const personName = `${c.firstName || ""} ${c.lastName || ""}`.trim().toLowerCase();
    const combo = personName && company ? `${personName} — ${company}`.toLowerCase() : "";
    const comboRev = personName && company ? `${company} — ${personName}`.toLowerCase() : "";
    return (
      label === q ||
      name === q ||
      personName === q ||
      (combo && combo === q) ||
      (comboRev && comboRev === q) ||
      (company && company === q) ||
      (legalName && legalName === q) ||
      (fullName && fullName === q) ||
      (email && email === q)
    );
  });
}
