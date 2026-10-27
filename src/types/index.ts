/** Core domain types for the E-managment visa system. */

export type Currency = "USD" | "IRT";

/** Which calendar is used for birth-date / passport-date entry & display. */
export type CalendarMode = "jalali" | "gregorian";

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "select"
  | "multiselect"
  | "checkbox"
  | "url";

export type FieldEntity = "customer" | "request";

export interface Representative {
  id: string;
  name: string;
  phone?: string;
  contactInfo?: string;
  notes?: string;
  /** Round profile photo — JPEG data URL, square-cropped and downscaled. */
  photo?: string | null;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | null;
}

export interface Customer {
  id: string;
  firstName?: string;
  lastName?: string;
  /** Round profile photo — JPEG data URL, square-cropped and downscaled. */
  photo?: string | null;
  /** ISO yyyy-mm-dd (Gregorian, stored internally, shown per calendar setting). */
  birthDate?: string;
  passportNo?: string;
  passportIssueDate?: string;
  passportExpiryDate?: string;
  referrer?: string;
  notes?: string;
  /** Every customer is registered under a representative and inside a list. */
  representativeId?: string | null;
  listId?: string | null;
  /** Registration date — defaults to today, editable at creation. */
  registrationDate: string;
  /** Values keyed by custom-field key. Survives field-definition edits. */
  customValues?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | null;
}

export interface VisaRequest {
  id: string;
  customerId: string;
  representativeId: string | null;
  listId: string | null;
  visaType?: string;
  /** Tag ids. */
  tags: string[];
  /** Major units (dollars / tomans). Integer-safe math happens in utils/money. */
  quotedAmount?: number;
  currency?: Currency;
  registrationDate: string;
  issued: boolean;
  issuedAt?: string | null;
  notes?: string;
  customValues?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | null;
}

export interface ListFolder {
  id: string;
  name: string;
  description?: string;
  category?: string;
  startDate?: string;
  endDate?: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | null;
}

export interface Payment {
  id: string;
  representativeId: string;
  requestId: string | null;
  amount: number;
  currency: Currency;
  date: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  /** Urgent tags drive the "فوری" counters on dashboard & reports. */
  isUrgent: boolean;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | null;
}

export interface VisaType {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | null;
}

export interface CustomFieldDef {
  id: string;
  /** Stable identifier; never changes after creation. */
  key: string;
  label: string;
  type: FieldType;
  entity: FieldEntity;
  required: boolean;
  defaultValue?: string | number | boolean | string[] | null;
  /** Options for select / multiselect. */
  options?: string[];
  searchable: boolean;
  showInForm: boolean;
  showInDetails: boolean;
  includeInExport: boolean;
  order: number;
  disabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ActivityType =
  | "create"
  | "update"
  | "delete"
  | "archive"
  | "restore"
  | "issue"
  | "unissue"
  | "payment"
  | "backup"
  | "restore"
  | "settings"
  | "acc-post"
  | "acc-reverse"
  | "acc-cancel"
  | "acc-adjust"
  | "acc-reset";

export type ActivityEntity =
  | "customer"
  | "request"
  | "representative"
  | "list"
  | "payment"
  | "tag"
  | "settings"
  | "backup"
  | "accParty"
  | "accAccount"
  | "accTx"
  | "accOutstanding"
  | "accDoc"
  | "accSettings"
  | "accBackup";

export interface Activity {
  id: string;
  ts: number;
  type: ActivityType;
  entity: ActivityEntity;
  entityId?: string;
  title: string;
  detail?: string;
}

/** Slot ids are free-form strings: built-in ones, custom doc-type ids, "receipt", "other". */
export type AttachmentKind = string;

export interface Attachment {
  id: string;
  /** Owning customer — null for payment receipt photos. */
  customerId: string | null;
  /** Set when this is the receipt photo of a payment. */
  paymentId?: string | null;
  /** DocType id ("passport", "nidFront", … custom ids) or "receipt" / "other". */
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  blob: Blob;
  createdAt: number;
}

/** A user-definable document slot shown on the customer page (مدارک و تصاویر). */
export interface DocType {
  id: string;
  label: string;
  /**
   * Set when this slot belongs to ONE customer only (created by the AI smart
   * filing for that specific profile). Undefined/null = a global slot that
   * Settings manages and every customer shows.
   */
  customerId?: string | null;
  /**
   * Short one-line description — legacy field kept for data compatibility.
   * No longer shown or edited anywhere in the UI.
   */
  hint?: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | null;
}

export interface AppPreferences {
  id: "app";
  defaultCurrency: Currency;
  defaultVisaType?: string;
  /** Calendar used for birth & passport dates (picker + display). */
  passportDateCalendar: CalendarMode;
  rememberLastSelections: boolean;
  lastRepresentativeId?: string | null;
  lastListId?: string | null;
  /** Last mode used in the customer form: smart extraction vs manual. */
  /** Internal: default document slots have been seeded once. */
  docTypesSeeded?: boolean;
  /** Internal: legacy doc-type hints stripped once. */
  docHintsStripped?: boolean;
  /** Internal: bogus AI-created «کد ملی» doc slots purged once. */
  nidJunkPurged?: boolean;
  updatedAt: number;
}

/**
 * Attachment metadata without the binary payload. The ZIP full backup stores
 * these in data/database.json while the actual bytes travel in assets/.
 */
export interface AttachmentMeta {
  id: string;
  /** Owning customer — null for payment receipt photos. */
  customerId: string | null;
  paymentId?: string | null;
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
}

/** JSON backup file (attachments excluded by design). */
export interface BackupFile {
  format: "2customer-backup";
  version: number;
  exportedAt: number;
  schemaVersion: number;
  appVersion?: string;
  counts: Record<string, number>;
  data: {
    representatives: Representative[];
    customers: Customer[];
    requests: VisaRequest[];
    lists: ListFolder[];
    payments: Payment[];
    tags: Tag[];
    visaTypes: VisaType[];
    customFields: CustomFieldDef[];
    /** Present in newer backups. */
    docTypes?: DocType[];
    activities: Activity[];
    preferences: AppPreferences | null;
    /** Accounting section data — LEGACY: only old backups (made while the
     *  accounting module was bundled into the main backup) contain it. New
     *  full backups never include accounting; it has its own separate backup
     *  inside the حسابداری section. Kept optional so old files still restore. */
    acc?: import("../accounting/types").AccBackupData;
    /** ZIP full backup only: attachment metadata (bytes live in assets/).
     *  A legacy JSON restore refuses files carrying this field — the
     *  complete ZIP archive must be used instead. */
    attachments?: AttachmentMeta[];
    /** ZIP full backup (encrypted) only: AI worker accounts. API keys are
     *  only ever exported inside a password-encrypted archive. */
    aiWorkers?: import("../lib/ai/types").AiWorker[];
    aiMeta?: import("../lib/ai/types").AiSettings | null;
  };
}

export interface EncryptedBackup {
  format: "2customer-encrypted-backup";
  version: number;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  data: string;
  exportedAt: number;
}

export const CURRENCY_LABELS: Record<Currency, string> = {
  USD: "دلار",
  IRT: "تومان",
};

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "متن کوتاه",
  textarea: "متن بلند",
  number: "عدد",
  date: "تاریخ",
  select: "انتخاب تک‌گزینه‌ای",
  multiselect: "انتخاب چندگزینه‌ای",
  checkbox: "چک‌باکس",
  url: "لینک",
};
