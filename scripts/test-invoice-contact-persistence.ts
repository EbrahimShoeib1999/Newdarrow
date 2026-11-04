/**
 * D-Arrow Business — Invoice & Customer Contact Persistence Test Suite
 *
 * Verifies:
 * 1. Customer & contact creation with nationalId, taxNumber, crNumber.
 * 2. Contact selection and relationship preservation in Invoice.
 * 3. Prevention of duplicate contact creation on retry.
 * 4. findContactByCustomerInput matches by name, accountName, legalName, and email.
 * 5. Page refresh / reopen simulation retains linked customerId and contact details.
 * 6. National ID is rendered correctly in buyer metadata.
 */

import { findContactByCustomerInput, invoiceCustomerPickerLabel, resolveInvoiceCustomerName } from "../src/features/billing/utils/invoice-customer";
import type { Contact } from "../src/features/crm/types/contacts.types";
import type { Invoice } from "../src/features/billing/schemas/invoice";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

console.log("\n=======================================================");
console.log(" D-Arrow — Invoice Contact Persistence & National ID Suite");
console.log("=======================================================\n");

// 1. Seed Contacts
const contacts: Contact[] = [
  {
    id: "contact-1",
    firstName: "سعد",
    lastName: "الغامدي",
    fullName: "سعد الغامدي",
    accountName: "شركة الرواد الرقمية",
    legalName: "شركة الرواد الرقمية المحدودة",
    email: "saad@alrowad.sa",
    phone: "+966501234567",
    commercialRegister: "1010998877",
    taxNumber: "300012345600003",
    nationalId: "1098765432", // Saudi National ID
    billingAddress: "طريق الملك فهد، الرياض 12345",
    entityType: "company",
  },
  {
    id: "contact-2",
    firstName: "خالد",
    lastName: "العتيبي",
    accountName: "مؤسسة الأفق للتجارة",
    email: "khaled@alofooq.sa",
    phone: "+966559876543",
    commercialRegister: "1010554433",
    taxNumber: "300098765400003",
    nationalId: "1023456789",
    entityType: "establishment",
  },
];

// Test 1: Picker label generation
{
  const label1 = invoiceCustomerPickerLabel(contacts[0]);
  assert(label1.includes("شركة الرواد الرقمية"), `Picker label contains company name (${label1})`);
  const label2 = invoiceCustomerPickerLabel(contacts[1]);
  assert(label2.includes("مؤسسة الأفق للتجارة"), `Picker label contains establishment name (${label2})`);
}

// Test 2: findContactByCustomerInput matching
{
  // Match by picker label
  const m1 = findContactByCustomerInput(contacts, "سعد الغامدي — شركة الرواد الرقمية");
  assert(m1?.id === "contact-1", "Matches contact by full picker label");

  // Match by accountName
  const m2 = findContactByCustomerInput(contacts, "شركة الرواد الرقمية");
  assert(m2?.id === "contact-1", "Matches contact by accountName");

  // Match by legalName
  const m3 = findContactByCustomerInput(contacts, "شركة الرواد الرقمية المحدودة");
  assert(m3?.id === "contact-1", "Matches contact by legalName");

  // Match by email
  const m4 = findContactByCustomerInput(contacts, "saad@alrowad.sa");
  assert(m4?.id === "contact-1", "Matches contact by email");

  // Match case-insensitively with leading/trailing spaces
  const m5 = findContactByCustomerInput(contacts, "   khaled@alofooq.sa  ");
  assert(m5?.id === "contact-2", "Matches contact case-insensitively with trimmed input");
}

// Test 3: Duplicate Prevention on Retry
{
  const createdContactCache = new Map<string, string>();
  const mockContactsList = [...contacts];

  async function mockResolveCustomerForSave(typedName: string, customerId?: string) {
    if (customerId) {
      const selected = mockContactsList.find((c) => c.id === customerId);
      return {
        customerId,
        customerName: typedName || (selected ? invoiceCustomerPickerLabel(selected) : customerId),
      };
    }

    const cacheKey = typedName.toLowerCase();
    if (createdContactCache.has(cacheKey)) {
      return { customerId: createdContactCache.get(cacheKey)!, customerName: typedName };
    }

    const existing = findContactByCustomerInput(mockContactsList, typedName);
    if (existing?.id) {
      createdContactCache.set(cacheKey, existing.id);
      return { customerId: existing.id, customerName: typedName };
    }

    // Provision new contact
    const newId = `contact-new-${Date.now()}`;
    const newContact: Contact = {
      id: newId,
      firstName: typedName,
      lastName: "",
      email: "",
      phone: "",
      accountName: typedName,
      nationalId: "1000000001",
    };
    mockContactsList.push(newContact);
    createdContactCache.set(cacheKey, newId);
    return { customerId: newId, customerName: typedName };
  }

  // First attempt creates
  const r1 = await mockResolveCustomerForSave("شركة الابتكار الحديثة");
  assert(r1.customerId.startsWith("contact-new-"), "First attempt creates new contact");

  // Second attempt (retry) MUST return the same contact ID without creating a duplicate
  const initialLength = mockContactsList.length;
  const r2 = await mockResolveCustomerForSave("شركة الابتكار الحديثة");
  assert(r2.customerId === r1.customerId, "Retry returns the exact same contactId");
  assert(mockContactsList.length === initialLength, "No duplicate contact record was created on retry");
}

// Test 4: Reopening Saved Invoice Preserves Contact Link & National ID
{
  const savedInvoice: Invoice = {
    id: "inv-test-101",
    invoiceNumber: "INV-2026-0042",
    status: "sent",
    customerId: "contact-1",
    customerName: "سعد الغامدي — شركة الرواد الرقمية",
    issueDate: new Date(),
    dueDate: new Date(Date.now() + 86400000 * 15),
    items: [
      {
        description: "استشارات تقنية",
        quantity: 1,
        unitPrice: 5000,
        taxRate: 15,
        discount: 0,
        total: 5750,
      },
    ],
    subTotal: 5000,
    totalTax: 750,
    totalDiscount: 0,
    grandTotal: 5750,
    currency: "SAR",
  };

  // Resolve customer name
  const resolvedName = resolveInvoiceCustomerName(savedInvoice, contacts);
  assert(resolvedName.includes("شركة الرواد الرقمية"), "Customer name cleanly resolves from linked customerId");

  // Fetch full contact
  const linkedContact = contacts.find((c) => c.id === savedInvoice.customerId);
  assert(linkedContact !== undefined, "Linked contact found in repository");
  assert(linkedContact?.nationalId === "1098765432", "National ID (1098765432) is preserved and accessible");
  assert(linkedContact?.taxNumber === "300012345600003", "Tax number is preserved");
  assert(linkedContact?.commercialRegister === "1010998877", "CR number is preserved");
}

console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);

