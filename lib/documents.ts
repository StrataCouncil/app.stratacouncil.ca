/**
 * Document repository vocabulary shared by server and browser code
 * (doc01 §4 — the nine folders; `agenda_attachments` is system-assigned).
 */

export const documentCategories = [
  "building_construction",
  "contracts_service_agreements",
  "correspondence",
  "financial_accounting",
  "insurance",
  "legal_governance",
  "meetings_records",
  "agenda_attachments",
  "operations",
] as const;
export type DocumentCategory = (typeof documentCategories)[number];

/** Folders an uploader can pick or move into — everything but agenda_attachments. */
export const pickableDocumentCategories = documentCategories.filter(
  (c): c is Exclude<DocumentCategory, "agenda_attachments"> => c !== "agenda_attachments"
);

export const documentCategoryLabels: Record<DocumentCategory, string> = {
  building_construction: "Building & Construction",
  contracts_service_agreements: "Contracts & Service Agreements",
  correspondence: "Correspondence",
  financial_accounting: "Financial & Accounting",
  insurance: "Insurance",
  legal_governance: "Legal & Governance",
  meetings_records: "Meetings & Records",
  agenda_attachments: "Agenda Attachments",
  operations: "Operations",
};

export const documentCategoryDescriptions: Record<DocumentCategory, string> = {
  building_construction: "Building plans, envelope reports, depreciation reports, engineering assessments.",
  contracts_service_agreements: "Vendor and contractor agreements, service contracts, warranties.",
  correspondence: "Owner notices, demand letters, and other formal correspondence.",
  financial_accounting: "Budgets, audited financials, special levies, reserve fund records.",
  insurance: "Policy documents, claims history, EGL requirements.",
  legal_governance: "Bylaws, rules, resolutions, and other governing documents.",
  meetings_records: "Other meeting-related records. Finalized minutes live in the Minutes tab, not here.",
  agenda_attachments: "Files and links attached to agenda items. Filed here automatically.",
  operations: "Building operations, maintenance schedules, and day-to-day records.",
};

export function isDocumentCategory(value: string): value is DocumentCategory {
  return (documentCategories as readonly string[]).includes(value);
}

/** What the upload picker accepts. */
export const acceptedExtensions = ["pdf", "doc", "docx", "txt", "jpg", "jpeg", "png", "xlsx", "csv"] as const;
/** What the indexer can read text out of; the rest are stored for reference only. */
export const indexableExtensions = ["pdf", "docx", "txt"] as const;

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 20;

export function fileExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isIndexableFile(name: string) {
  return (indexableExtensions as readonly string[]).includes(fileExtension(name));
}

export type IndexingStatus = "pending" | "processing" | "indexed" | "failed" | "not_indexable" | "needs_text";

/** Private Storage bucket for corporation documents; paths are `<corp>/<uuid>/<file>`. */
export const DOCUMENTS_BUCKET = "corporation-documents";
