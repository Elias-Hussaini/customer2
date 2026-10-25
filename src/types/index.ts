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
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | null;
}

export interface Customer {
  id: string;
  firstName?: string;
  lastName?: string;
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
  | "settings";

export type ActivityEntity =
  | "customer"
  | "request"
  | "representative"
  | "list"
  | "payment"
  | "tag"
  | "settings"
  | "backup";

export interface Activity {
  id: string;
  ts: number;
  type: ActivityType;
  entity: ActivityEntity;
  entityId?: string;
  title: string;
  detail?: string;
}

export type AttachmentKind = "passport" | "nidFront" | "nidBack" | "other";

export interface Attachment {
  id: string;
  customerId: string;
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  blob: Blob;
  createdAt: number;
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
  updatedAt: number;
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
    activities: Activity[];
    preferences: AppPreferences | null;
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
