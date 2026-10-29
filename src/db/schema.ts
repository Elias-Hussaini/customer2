import Dexie, { type Table } from "dexie";
import type {
  Activity,
  AppPreferences,
  Attachment,
  CustomFieldDef,
  Customer,
  DocType,
  Employer,
  ListFolder,
  Payment,
  Representative,
  Tag,
  VisaRequest,
  VisaType,
} from "../types";
import type {
  AccDoc,
  AccParty,
  AccSettings,
  FinAccount,
  FinTransaction,
  OutstandingItem,
} from "../accounting/types";
import type { AiSettings, AiWorker } from "../lib/ai/types";
import type { AgentChatRecord } from "../lib/agent/types";

/**
 * Local IndexedDB database. All application data lives here — in the user's
 * browser. Nothing is ever sent to a server.
 *
 * Schema is versioned; add migrations by appending `this.version(n+1).stores(...)`
 * blocks below without touching earlier versions.
 */
export class VisaDB extends Dexie {
  representatives!: Table<Representative, string>;
  employers!: Table<Employer, string>;
  customers!: Table<Customer, string>;
  requests!: Table<VisaRequest, string>;
  lists!: Table<ListFolder, string>;
  payments!: Table<Payment, string>;
  tags!: Table<Tag, string>;
  visaTypes!: Table<VisaType, string>;
  customFields!: Table<CustomFieldDef, string>;
  activities!: Table<Activity, string>;
  attachments!: Table<Attachment, string>;
  docTypes!: Table<DocType, string>;
  preferences!: Table<AppPreferences, string>;
  // Accounting section (بخش حسابداری) — separate financial world.
  accParties!: Table<AccParty, string>;
  accAccounts!: Table<FinAccount, string>;
  accTransactions!: Table<FinTransaction, string>;
  accOutstanding!: Table<OutstandingItem, string>;
  accDocs!: Table<AccDoc, string>;
  accMeta!: Table<AccSettings, string>;
  // AI worker accounts (Cloudflare) + AI settings. Local-only on purpose:
  // API keys are NOT exported with the customer JSON backup.
  aiWorkers!: Table<AiWorker, string>;
  aiMeta!: Table<AiSettings, string>;
  // AI assistant chat history (دستیار هوشمند) — conversations with the agent.
  aiChats!: Table<AgentChatRecord, string>;

  constructor() {
    super("customer2-visa");
    this.version(1).stores({
      representatives: "id, name, createdAt, archivedAt",
      customers: "id, firstName, lastName, passportNo, registrationDate, createdAt, archivedAt",
      requests:
        "id, customerId, representativeId, listId, visaType, issued, registrationDate, createdAt, archivedAt",
      lists: "id, name, createdAt, archivedAt",
      payments: "id, representativeId, requestId, currency, date, createdAt",
      tags: "id, name, createdAt, archivedAt",
      visaTypes: "id, name, createdAt, archivedAt",
      customFields: "id, key, entity, order, disabled",
      activities: "id, ts, entity, entityId",
      attachments: "id, customerId, kind, createdAt",
      preferences: "id",
    });
    // v2: customers are always registered inside a list and under a
    // representative — index both for filtering and cascade detach.
    this.version(2).stores({
      customers:
        "id, firstName, lastName, passportNo, registrationDate, createdAt, archivedAt, listId, representativeId",
    });
    // v3: user-definable document slots (مدارک و تصاویر) + payment receipt
    // photos. Attachments gain a paymentId index; receipts keep customerId null.
    this.version(3).stores({
      attachments: "id, customerId, paymentId, kind, createdAt",
      docTypes: "id, order, createdAt, archivedAt",
    });
    // v4: visa-application PDF fill templates (smart document tools).
    // Files live here, not in JSON backups (re-creatable, potentially large).
    this.version(4).stores({
      pdfTemplates: "id, updatedAt",
    });
    // v5: the template manager UI was removed — document templates are no
    // longer stored in the database. Drop the stored templates.
    this.version(5).stores({
      pdfTemplates: null,
    });
    // v6: accounting module (بخش حسابداری) — parties, managed cash/bank
    // accounts, financial transactions, outstanding items, documents and
    // module settings. Balances are derived from accTransactions.
    this.version(6).stores({
      accParties: "id, code, type, name, active, createdAt, photoDocId",
      accAccounts: "id, name, type, currency, active, createdAt",
      accTransactions:
        "id, number, type, partyId, sourceAccountId, destAccountId, currency, date, status, createdAt",
      accOutstanding: "id, partyId, kind, status, dueDate, currency, createdAt",
      accDocs: "id, partyId, transactionId, accountId, createdAt",
      accMeta: "id",
    });
    // v7: AI section (هوش مصنوعی) — the user's own Cloudflare worker
    // accounts (url + key + model, with failover order) and AI settings.
    this.version(7).stores({
      aiWorkers: "id, priority, createdAt",
      aiMeta: "id",
    });
    // v8: employers (کارفرما) — an OPTIONAL customer attribute managed in
    // Settings; customers gain an employerId index for filtering/detach.
    this.version(8).stores({
      employers: "id, name, createdAt, archivedAt",
      customers:
        "id, firstName, lastName, passportNo, registrationDate, createdAt, archivedAt, listId, representativeId, employerId",
    });
    // v9: AI assistant chat history (دستیار هوشمند).
    this.version(9).stores({
      aiChats: "id, updatedAt",
    });
  }
}

export const db = new VisaDB();

export const DB_TABLES = [
  "representatives",
  "employers",
  "customers",
  "requests",
  "lists",
  "payments",
  "tags",
  "visaTypes",
  "customFields",
  "activities",
  "attachments",
  "docTypes",
  "preferences",
] as const;
