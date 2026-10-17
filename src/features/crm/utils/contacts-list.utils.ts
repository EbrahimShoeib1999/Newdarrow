import type {
  Contact,
  ContactClassification,
  CustomerSatisfaction,
  EntityType,
  ContactRelationship,
} from "../types/contacts.types";

export type ContactSortField =
  | "name"
  | "email"
  | "accountName"
  | "createdAt"
  | "classification"
  | "satisfaction"
  | "source"
  | "status"
  | "entityType";
export type ContactSortOrder = "asc" | "desc";

export interface ContactsListParams {
  search?: string;
  assignedTo?: string;
  entityType?: EntityType | "all";
  relationship?: ContactRelationship | "all";
  classification?: ContactClassification | "all";
  satisfaction?: CustomerSatisfaction | "all";
  source?: string;
  status?: string;
  city?: string;
  sortField?: ContactSortField;
  sortOrder?: ContactSortOrder;
  page?: number;
  pageSize?: number;
}

export function contactDisplayName(contact: Contact | null | undefined): string {
  if (!contact) return "—";

  // If company, establishment, government, bank, non_profit, media, etc.
  if (
    contact.entityType &&
    contact.entityType !== "individual" &&
    contact.accountName?.trim()
  ) {
    return contact.accountName.trim();
  }

  if (contact.fullName?.trim()) {
    return contact.fullName.trim();
  }

  const personName = `${contact.firstName || ""} ${contact.fatherName ? contact.fatherName + " " : ""}${contact.lastName || ""}`.trim();
  if (personName) return personName;

  if (contact.accountName?.trim()) {
    return contact.accountName.trim();
  }

  return contact.email || contact.phone || "—";
}

function contactMatchesSearch(contact: Contact, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;

  const interestsStr = (contact.interests || []).join(" ");
  const tagsStr = (contact.tags || []).join(" ");
  const relationshipsStr = (contact.relationships || []).join(" ");
  const associatedStr = (contact.associatedContacts || [])
    .map((c) => `${c.name} ${c.jobTitle || ""} ${c.phone || ""} ${c.email || ""}`)
    .join(" ");
  const addressesStr = (contact.addresses || [])
    .map((a) => `${a.city || ""} ${a.district || ""} ${a.street || ""}`)
    .join(" ");

  return [
    contact.firstName,
    contact.lastName,
    contact.fatherName,
    contact.fullName,
    contactDisplayName(contact),
    contact.email,
    contact.phone,
    contact.secondaryPhone,
    contact.whatsappPhone,
    contact.landlinePhone,
    contact.accountName,
    contact.legalName,
    contact.commercialRegister,
    contact.unifiedNumber,
    contact.taxNumber,
    contact.city,
    contact.region,
    contact.jobTitle,
    contact.department,
    contact.source,
    contact.status,
    contact.entityType,
    contact.mainActivity,
    interestsStr,
    tagsStr,
    relationshipsStr,
    associatedStr,
    addressesStr,
  ]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q));
}

export function filterContacts(contacts: Contact[], params: ContactsListParams): Contact[] {
  return contacts.filter((contact) => {
    if (params.search && !contactMatchesSearch(contact, params.search)) return false;

    if (params.assignedTo === "__unassigned__" && contact.assignedTo) return false;
    if (
      params.assignedTo &&
      params.assignedTo !== "__unassigned__" &&
      contact.assignedTo !== params.assignedTo
    ) {
      return false;
    }

    // Entity Type filter
    if (params.entityType && params.entityType !== "all") {
      const eType = contact.entityType || (contact.commercialRegister ? "company" : "individual");
      if (eType !== params.entityType) return false;
    }

    // Relationship filter (checks array or fallback classification)
    if (params.relationship && params.relationship !== "all") {
      const rels = contact.relationships || [];
      const hasRel =
        rels.includes(params.relationship) ||
        (contact.classification && contact.classification === params.relationship);
      if (!hasRel) return false;
    }

    if (params.classification && params.classification !== "all") {
      if (contact.classification !== params.classification) return false;
    }

    if (params.satisfaction && params.satisfaction !== "all") {
      if (contact.satisfaction !== params.satisfaction) return false;
    }

    if (params.source && params.source !== "all") {
      if ((contact.source || "").toLowerCase() !== params.source.toLowerCase()) return false;
    }

    if (params.status && params.status !== "all") {
      const contactStatus = contact.status || "active";
      if (contactStatus.toLowerCase() !== params.status.toLowerCase()) return false;
    }

    if (params.city && params.city !== "all") {
      if ((contact.city || "").toLowerCase() !== params.city.toLowerCase()) return false;
    }

    return true;
  });
}

export function sortContacts(
  contacts: Contact[],
  field: ContactSortField = "createdAt",
  order: ContactSortOrder = "desc"
): Contact[] {
  const dir = order === "asc" ? 1 : -1;
  return [...contacts].sort((a, b) => {
    let av: string | number = "";
    let bv: string | number = "";
    switch (field) {
      case "name":
        av = contactDisplayName(a).toLowerCase();
        bv = contactDisplayName(b).toLowerCase();
        break;
      case "email":
        av = (a.email || "").toLowerCase();
        bv = (b.email || "").toLowerCase();
        break;
      case "accountName":
        av = (a.accountName || "").toLowerCase();
        bv = (b.accountName || "").toLowerCase();
        break;
      case "entityType":
        av = a.entityType || "";
        bv = b.entityType || "";
        break;
      case "classification":
        av = a.classification || "";
        bv = b.classification || "";
        break;
      case "satisfaction":
        av = a.satisfaction || "";
        bv = b.satisfaction || "";
        break;
      case "source":
        av = (a.source || "").toLowerCase();
        bv = (b.source || "").toLowerCase();
        break;
      case "status":
        av = (a.status || "active").toLowerCase();
        bv = (b.status || "active").toLowerCase();
        break;
      case "createdAt":
      default:
        av = new Date(a.createdAt).getTime();
        bv = new Date(b.createdAt).getTime();
        break;
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

export function paginateContacts<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total,
    totalPages,
    page: safePage,
  };
}

export function applyContactsListPipeline(contacts: Contact[], params: ContactsListParams) {
  const filtered = filterContacts(contacts, params);
  const sorted = sortContacts(filtered, params.sortField, params.sortOrder);
  return paginateContacts(sorted, params.page ?? 1, params.pageSize ?? 10);
}
