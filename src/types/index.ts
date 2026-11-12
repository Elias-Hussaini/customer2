/** Core domain types for the E-managment visa system. */

export type Currency = "USD" | "IRT" | "AFN";

/** All currencies in display order (تومان، دلار، افغانی). */
export const CURRENCIES: readonly Currency[] = ["IRT", "USD", "AFN"];

/** Fresh zero-bucket per currency — Record<Currency, number> initializer. */
export function zeroByCurrency(): Record<Currency, number> {
  return { USD: 0, IRT: 0, AFN: 0 };
}

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

export type FieldEntity = "customer" | "request" | "employer";

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

/** کارفرما — optional employer/sponsor attached to a customer.
 *
 *  Managed as a full entity (like customers & representatives): its own
 *  section, profile page with documents, and a rich contact record. */
export interface Employer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  /** کد ملی */
  nationalId?: string;
  /** نام کاربری سامانه‌های کارفرما */
  username?: string;
  /** رمز عبور — kept ONLY in the local IndexedDB, masked everywhere. */
  password?: string;
  address?: string;
  postalCode?: string;
  notes?: string;
  /** Round profile photo / logo — JPEG data URL. */
  photo?: string | null;
  /** Values keyed by custom-field key (entity: employer). */
  customValues?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | null;
}

/**
 * The customer's visa journey («مرحله‌های ویزا») — a linear pipeline from fresh
 * registration to an issued visa, plus the rejected side-state. Stored on the
 * customer; request-level issued/rejected flags stay the source of truth for
 * reports and exports.
 */
export type CustomerStage =
  | "stage1" // مرحله اول — تازه ثبت شده
  | "stage2" // ثبت شده برای کد اختصاصی
  | "stage3" // دارای کد اختصاصی
  | "stage4" // ثبت شده برای ویزا
  | "stage5" // صادر شده
  | "stage6"; // رد شده

/** Pipeline order (stage6 = rejected lives outside the line). */
export const CUSTOMER_STAGES: readonly CustomerStage[] = [
  "stage1",
  "stage2",
  "stage3",
  "stage4",
  "stage5",
  "stage6",
];

/** Persian labels — the single source of truth for UI, tooltips and filters. */
export const CUSTOMER_STAGE_LABELS: Record<CustomerStage, string> = {
  stage1: "مرحله اول",
  stage2: "ثبت شده برای کد اختصاصی",
  stage3: "دارای کد اختصاصی",
  stage4: "ثبت شده برای ویزا",
  stage5: "صادر شده",
  stage6: "رد شده",
};

export function customerStageLabel(s: CustomerStage | null | undefined): string {
  return s ? (CUSTOMER_STAGE_LABELS[s] ?? "") : "";
}

/**
 * Default stage colors — a deliberate progression (slate → violet → blue →
 * amber → green, red for rejected). Users can override every color in
 * Settings → «مراحل و رنگ‌ها»; prefs store only the overrides.
 */
export const DEFAULT_STAGE_COLORS: Record<CustomerStage, string> = {
  stage1: "#94a3b8",
  stage2: "#8b5cf6",
  stage3: "#3b82f6",
  stage4: "#f59e0b",
  stage5: "#10b981",
  stage6: "#ef4444",
};

/** Resolve the effective color of a stage (prefs overrides win). */
export function customerStageColor(
  s: CustomerStage | null | undefined,
  overrides?: Partial<Record<CustomerStage, string>> | null,
): string {
  if (!s) return DEFAULT_STAGE_COLORS.stage1;
  return overrides?.[s] || DEFAULT_STAGE_COLORS[s];
}

/** Pipeline order without the rejected side-state. */
const STAGE_PIPELINE: readonly CustomerStage[] = [
  "stage1",
  "stage2",
  "stage3",
  "stage4",
  "stage5",
];

export function stageOrder(s: CustomerStage): number {
  return STAGE_PIPELINE.indexOf(s);
}

/** Next stage in the pipeline; rejected re-enters at «ثبت شده برای ویزا». */
export function nextStageOf(s: CustomerStage): CustomerStage {
  if (s === "stage6") return "stage4";
  const i = STAGE_PIPELINE.indexOf(s);
  return i < 0 || i >= STAGE_PIPELINE.length - 1 ? s : STAGE_PIPELINE[i + 1];
}

/** Previous stage in the pipeline; rejected falls back to «ثبت شده برای ویزا». */
export function prevStageOf(s: CustomerStage): CustomerStage {
  if (s === "stage6") return "stage4";
  const i = STAGE_PIPELINE.indexOf(s);
  return i <= 0 ? s : STAGE_PIPELINE[i - 1];
}

/**
 * Map a saved visa-status filter value to the new stage keys. Legacy values
 * ("issued" / "pending" / "rejected") from before the stage system keep
 * working: they translate to the closest stage.
 */
export function normalizeStageFilter(v: string): string {
  if (v === "" || v === "none") return v;
  if ((CUSTOMER_STAGES as readonly string[]).includes(v)) return v;
  switch (v) {
    case "issued":
      return "stage5";
    case "pending":
      return "stage4";
    case "rejected":
      return "stage6";
    default:
      return "";
  }
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
  /** شغل — free-text occupation. */
  job?: string;
  notes?: string;
  /** Every customer is registered under a representative and inside a list. */
  representativeId?: string | null;
  listId?: string | null;
  /** Optional employer (کارفرما) — null = بدون کارفرما. */
  employerId?: string | null;
  /** The customer's visa journey stage («مرحله‌های ویزا»). Absent = derived
   *  from their requests / special-code field (see db/stages.ts). */
  stage?: CustomerStage | null;
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
  /** Sticky manual override: the representative was set BY HAND in the visa
   *  request itself, so later profile-representative changes must NOT sync
   *  this row (round 22 — «مگر اینکه بعدا بریم باز دستی دوباره توی درخواست
   *  ویزا عوضش کنیم»). Undefined/false = follows the customer's profile. */
  repOverride?: boolean;
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
  /** The visa application was REJECTED by the embassy. Mutually exclusive with issued. */
  rejected?: boolean;
  /** ISO date the rejection was recorded. */
  rejectedAt?: string | null;
  notes?: string;
  customValues?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | null;
}

/** Persian status label of a request — single source of truth for UI, exports & search. */
export function requestStatusFa(r: Pick<VisaRequest, "issued" | "rejected">): string {
  if (r.rejected && !r.issued) return "رد شده";
  return r.issued ? "صادر شده" : "در حال کار";
}

export type VisaRequestStatus = "issued" | "pending" | "rejected";

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
  /** Windows-style hierarchy — the folder this list lives inside (null = root). */
  parentId?: string | null;
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
  | "reject"
  | "unreject"
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
  | "employer"
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
  /** Owning customer — null for payment receipts and employer documents. */
  customerId: string | null;
  /** Set for employer (کارفرما) profile documents. */
  employerId?: string | null;
  /** Set when this is the receipt photo of a payment. */
  paymentId?: string | null;
  /** DocType id ("passport", "nidFront", … custom ids) or "receipt" / "other". */
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  blob: Blob;
  createdAt: number;
  /** Timestamp of the last at-rest compression attempt (background pass marker). */
  opt?: number;
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
  /** Last employer picked in the customer form (remembered like rep/list). */
  lastEmployerId?: string | null;
  /** کارفرما feature master switch — off hides the field everywhere. */
  employerFieldEnabled?: boolean;
  /** Profile photos auto-convert to 400×600 (نسبت آزاد) when set — default ON. */
  profilePhotoAutoSize?: boolean;
  /** User overrides of the stage colors (Settings → مراحل و رنگ‌ها). */
  stageColors?: Partial<Record<CustomerStage, string>>;
  /** Last mode used in the customer form: smart extraction vs manual. */
  /** Internal: default document slots have been seeded once. */
  docTypesSeeded?: boolean;
  /** Internal: legacy doc-type hints stripped once. */
  docHintsStripped?: boolean;
  /** Internal: bogus AI-created «کد ملی» doc slots purged once. */
  nidJunkPurged?: boolean;
  /** Internal: legacy shared AI doc slots re-scoped to their single owner once. */
  docOwnerScoped?: boolean;
  /** Internal: one-time backfill — every visa request's representative synced
   *  to its customer's current profile representative (round 22). */
  repSyncBackfilled?: boolean;
  updatedAt: number;
}

/**
 * Attachment metadata without the binary payload. The ZIP full backup stores
 * these in data/database.json while the actual bytes travel in assets/.
 */
export interface AttachmentMeta {
  id: string;
  /** Owning customer — null for payment receipt photos and employer documents. */
  customerId: string | null;
  employerId?: string | null;
  paymentId?: string | null;
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  /** Last at-rest compression timestamp — survives the ZIP round trip. */
  opt?: number;
}


/* ------------------------- Image Studio (ابزار عکس) ----------------------- */

/** A named folder in the image studio's in-app library. */
export interface StudioFolder {
  id: string;
  name: string;
  /** Parent folder — null/undefined = root level (Windows-style nesting). */
  parentId?: string | null;
  createdAt: number;
  updatedAt: number;
}

/** An edited image saved into the studio library (bytes as chosen by the user). */
export interface StudioImage {
  id: string;
  /** null = «سایر» (unfiled). */
  folderId: string | null;
  name: string;
  mime: string;
  size: number;
  blob: Blob;
  width: number;
  height: number;
  /** Optional note attached in the library. */
  note?: string;
  createdAt: number;
  updatedAt: number;
}

/** Metadata only — bytes travel separately inside the ZIP backup. */
export type StudioImageMeta = Omit<StudioImage, "blob">;

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
    /** Present in newer backups — employers (کارفرما) are optional everywhere. */
    employers?: Employer[];
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
    /** Accounting section data (بخش حسابداری) — complete-system ZIP backups
     *  (format v2+) bundle the whole financial world here: parties, accounts,
     *  transactions, outstanding items, document metadata (bytes under
     *  assets/acc-docs/) and module settings. Older v1 archives and legacy
     *  JSON exports may lack it; the field stays optional for compatibility. */
    acc?: import("../accounting/types").AccBackupData;
    /** AI assistant chat history (گفتگوهای دستیار) — ZIP v2+ only. */
    chats?: import("../lib/agent/types").AgentChatRecord[];
    /** ZIP full backup only: attachment metadata (bytes live in assets/).
     *  A legacy JSON restore refuses files carrying this field — the
     *  complete ZIP archive must be used instead. */
    attachments?: AttachmentMeta[];
    /** ZIP full backup (v3+): studio folders (ابزار عکس) — records only. */
    studioFolders?: import("../db/studio").StudioFolder[];
    /** ZIP full backup (v3+) only: studio image metadata (bytes live in
     *  assets/studio/). A legacy JSON restore refuses files carrying this
     *  field — the complete ZIP archive must be used instead. */
    studioImages?: import("../db/studio").StudioImageMeta[];
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
  AFN: "افغانی",
};

/** Persian label of any currency value — single source of truth (no more
 *  `x === "USD" ? "دلار" : "تومان"" ternaries that silently drop AFN). */
export function currencyLabel(c: Currency | undefined | null): string {
  return c ? (CURRENCY_LABELS[c] ?? "") : "";
}

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
