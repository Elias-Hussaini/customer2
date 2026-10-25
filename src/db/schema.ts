import Dexie, { type Table } from "dexie";
import type {
  Activity,
  AppPreferences,
  Attachment,
  CustomFieldDef,
  Customer,
  ListFolder,
  Payment,
  Representative,
  Tag,
  VisaRequest,
  VisaType,
} from "../types";

/**
 * Local IndexedDB database. All application data lives here — in the user's
 * browser. Nothing is ever sent to a server.
 *
 * Schema is versioned; add migrations by appending `this.version(n+1).stores(...)`
 * blocks below without touching earlier versions.
 */
export class VisaDB extends Dexie {
  representatives!: Table<Representative, string>;
  customers!: Table<Customer, string>;
  requests!: Table<VisaRequest, string>;
  lists!: Table<ListFolder, string>;
  payments!: Table<Payment, string>;
  tags!: Table<Tag, string>;
  visaTypes!: Table<VisaType, string>;
  customFields!: Table<CustomFieldDef, string>;
  activities!: Table<Activity, string>;
  attachments!: Table<Attachment, string>;
  preferences!: Table<AppPreferences, string>;

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
  }
}

export const db = new VisaDB();

export const DB_TABLES = [
  "representatives",
  "customers",
  "requests",
  "lists",
  "payments",
  "tags",
  "visaTypes",
  "customFields",
  "activities",
  "attachments",
  "preferences",
] as const;
