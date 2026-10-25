import type {
  CustomFieldDef,
  Customer,
  ListFolder,
  Representative,
  Tag,
  VisaRequest,
} from "../types";
import { normalizeFa, normalizePassport, normalizePhone } from "../utils/normalize";
import { customerFullName } from "../db/customers";

/** A text fragment with a search weight. Bigger weight = more relevant. */
interface Weighted {
  text: string;
  weight: number;
}

export type HitType = "customer" | "representative" | "request" | "list";

export interface SearchHit {
  type: HitType;
  id: string;
  title: string;
  subtitle?: string;
  score: number;
  /** Where the hit came from, e.g. «شماره پاسپورت». */
  context?: string;
}

export interface SearchDataset {
  customers: Customer[];
  representatives: Representative[];
  requests: VisaRequest[];
  lists: ListFolder[];
  tagsById: Map<string, Tag>;
  customersById: Map<string, Customer>;
  repsById: Map<string, Representative>;
  listsById: Map<string, ListFolder>;
  searchableFields: CustomFieldDef[];
}

export function buildSearchDataset(
  customers: Customer[],
  representatives: Representative[],
  requests: VisaRequest[],
  lists: ListFolder[],
  tags: Tag[],
  customFields: CustomFieldDef[],
): SearchDataset {
  return {
    customers,
    representatives,
    requests,
    lists,
    tagsById: new Map(tags.map((t) => [t.id, t])),
    customersById: new Map(customers.map((c) => [c.id, c])),
    repsById: new Map(representatives.map((r) => [r.id, r])),
    listsById: new Map(lists.map((l) => [l.id, l])),
    searchableFields: customFields.filter((f) => f.searchable && !f.disabled),
  };
}

function customValuesText(record: { customValues?: Record<string, unknown> }, fields: CustomFieldDef[]): Weighted[] {
  if (!record.customValues) return [];
  const out: Weighted[] = [];
  for (const field of fields) {
    const v = record.customValues[field.key];
    if (v == null || v === "" || v === false) continue;
    const text = Array.isArray(v) ? v.join(" ") : String(v);
    if (text) out.push({ text: `${text} ${field.label}`, weight: 1 });
  }
  return out;
}

/** All tokens must match somewhere; score sums the best weight per token. */
function scoreFields(tokens: string[], fields: Weighted[]): number {
  if (tokens.length === 0) return 0;
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const f of fields) {
      const norm = normalizeFa(f.text);
      if (norm.includes(token)) {
        best = Math.max(best, f.weight * (norm.includes(` ${token} `) || norm.startsWith(token) ? 1.2 : 1));
      }
    }
    if (best === 0) return 0; // AND semantics
    total += best;
  }
  return total;
}

export interface SearchFilters {
  types?: HitType[];
  representativeId?: string | null;
  listId?: string | null;
  visaType?: string | null;
  issued?: boolean | null;
  tagId?: string | null;
  currency?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

function requestPassesFilters(r: VisaRequest, ds: SearchDataset, f: SearchFilters): boolean {
  if (f.representativeId && r.representativeId !== f.representativeId) return false;
  if (f.listId && r.listId !== f.listId) return false;
  if (f.visaType && r.visaType !== f.visaType) return false;
  if (f.issued != null && r.issued !== f.issued) return false;
  if (f.tagId && !r.tags.includes(f.tagId)) return false;
  if (f.currency && r.currency !== f.currency) return false;
  if (f.dateFrom && r.registrationDate < f.dateFrom) return false;
  if (f.dateTo && r.registrationDate > f.dateTo) return false;
  return true;
}

export function searchDataset(query: string, ds: SearchDataset, filters: SearchFilters = {}, limitPerType = 30): SearchHit[] {
  const rawTokens = normalizeFa(query).split(" ").filter(Boolean);
  const queryNorm = normalizePassport(query);
  const queryPhone = normalizePhone(query);
  const types = filters.types;

  const hits: SearchHit[] = [];

  if (!types || types.includes("customer")) {
    for (const c of ds.customers) {
      if (filters.dateFrom && c.registrationDate < filters.dateFrom) continue;
      if (filters.dateTo && c.registrationDate > filters.dateTo) continue;
      const name = customerFullName(c);
      const fields: Weighted[] = [
        { text: name, weight: 5 },
        { text: c.firstName ?? "", weight: 4 },
        { text: c.lastName ?? "", weight: 4 },
        { text: c.passportNo ?? "", weight: 4 },
        { text: c.referrer ?? "", weight: 2 },
        { text: c.notes ?? "", weight: 1 },
        ...customValuesText(c, ds.searchableFields.filter((f) => f.entity === "customer")),
      ];
      let score = scoreFields(rawTokens, fields);
      if (queryNorm && c.passportNo && normalizePassport(c.passportNo).includes(queryNorm)) score += 6;
      if (score > 0) {
        hits.push({
          type: "customer",
          id: c.id,
          title: name,
          subtitle: c.passportNo ? `پاسپورت ${c.passportNo}` : undefined,
          score,
        });
      }
    }
  }

  if (!types || types.includes("representative")) {
    for (const r of ds.representatives) {
      const fields: Weighted[] = [
        { text: r.name, weight: 5 },
        { text: r.phone ?? "", weight: 4 },
        { text: r.contactInfo ?? "", weight: 2 },
        { text: r.notes ?? "", weight: 1 },
      ];
      let score = scoreFields(rawTokens, fields);
      if (queryPhone && r.phone && normalizePhone(r.phone).includes(queryPhone)) score += 6;
      if (score > 0) {
        hits.push({
          type: "representative",
          id: r.id,
          title: r.name,
          subtitle: r.phone,
          score,
        });
      }
    }
  }

  if (!types || types.includes("request")) {
    for (const r of ds.requests) {
      if (!requestPassesFilters(r, ds, filters)) continue;
      const customer = ds.customersById.get(r.customerId);
      const tagNameTexts = r.tags
        .map((t) => ds.tagsById.get(t)?.name ?? "")
        .filter(Boolean)
        .join(" ");
      const fields: Weighted[] = [
        { text: customer ? customerFullName(customer) : "", weight: 4 },
        { text: customer?.passportNo ?? "", weight: 3 },
        { text: r.visaType ?? "", weight: 4 },
        { text: tagNameTexts, weight: 2 },
        { text: r.notes ?? "", weight: 1 },
        { text: ds.repsById.get(r.representativeId ?? "")?.name ?? "", weight: 2 },
        { text: ds.listsById.get(r.listId ?? "")?.name ?? "", weight: 2 },
        ...customValuesText(r, ds.searchableFields.filter((f) => f.entity === "request")),
      ];
      const score = scoreFields(rawTokens, fields);
      if (score > 0) {
        hits.push({
          type: "request",
          id: r.id,
          title: customer ? customerFullName(customer) : "درخواست",
          subtitle: [
            r.visaType,
            r.issued ? "صادر شده" : "در حال کار",
            ds.repsById.get(r.representativeId ?? "")?.name,
          ]
            .filter(Boolean)
            .join(" • "),
          score,
        });
      }
    }
  }

  if (!types || types.includes("list")) {
    for (const l of ds.lists) {
      const fields: Weighted[] = [
        { text: l.name, weight: 5 },
        { text: l.category ?? "", weight: 3 },
        { text: l.description ?? "", weight: 1 },
      ];
      const score = scoreFields(rawTokens, fields);
      if (score > 0) {
        hits.push({ type: "list", id: l.id, title: l.name, subtitle: l.category, score });
      }
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limitPerType * 4);
}

/** Highlight matched tokens inside text for display. */
export function splitHighlight(text: string, query: string): string[] {
  const tokens = normalizeFa(query).split(" ").filter((t) => t.length > 0);
  if (tokens.length === 0) return [text];
  return text.split(new RegExp(`(${tokens.map(escapeRe).join("|")})`, "gi")).filter((p) => p !== "");
}

export function isHighlightPart(part: string, query: string): boolean {
  const tokens = normalizeFa(query).split(" ").filter((t) => t.length > 0);
  return tokens.some((t) => normalizeFa(part) === t || normalizeFa(part).includes(t));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
