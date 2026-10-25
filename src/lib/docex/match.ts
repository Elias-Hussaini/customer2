/**
 * Deterministic customer matching — never auto-merges. Produces ranked
 * candidates with explicit reasons; the operator makes the final call.
 */
import type { Customer } from "../../types";
import type { CanonicalField, ExtractedValue } from "./types";
import { namesMatch } from "./translit";

export type MatchLevel = "exact" | "high" | "medium" | "low";

export interface CustomerMatch {
  customer: Customer;
  level: MatchLevel;
  reasons: string[]; // Persian, for the UI
}

const LEVEL_ORDER: Record<MatchLevel, number> = { exact: 4, high: 3, medium: 2, low: 1 };

function val(fields: Partial<Record<CanonicalField, ExtractedValue>>, key: CanonicalField): string | null {
  const v = fields[key]?.value;
  return v != null && String(v).length > 0 ? String(v).toUpperCase().replace(/[\s\-\/.]/g, "") : null;
}

/**
 * Rank existing customers against extracted fields.
 * exact  : passport/document number identical
 * high   : name matches AND date of birth matches
 * medium : name matches OR (surname + dob) match
 * low    : dob matches only
 */
export function matchCustomers(
  fields: Partial<Record<CanonicalField, ExtractedValue>>,
  customers: Customer[],
  limit = 6,
): CustomerMatch[] {
  const docNo = val(fields, "documentNumber");
  const nationalId = val(fields, "nationalId");
  const surname = fields.surname?.value ?? null;
  const given = fields.givenNames?.value ?? null;
  const dob = fields.dateOfBirth?.value ?? null;
  const matches: CustomerMatch[] = [];

  for (const c of customers) {
    const reasons: string[] = [];
    let level: MatchLevel | null = null;

    const cPass = (c.passportNo ?? "").toUpperCase().replace(/[\s\-\/.]/g, "");
    if (docNo && cPass && (docNo === cPass || cPass.includes(docNo) || docNo.includes(cPass))) {
      level = "exact";
      reasons.push("شماره پاسپورت یکسان است");
    }

    const cNameFa = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
    const cGiven = (c.firstName ?? "").trim();
    const cLast = (c.lastName ?? "").trim();
    const nameMatch =
      (given && surname && namesMatch(cNameFa, `${given} ${surname}`)) ||
      (given && cGiven && namesMatch(cGiven, given)) ||
      (surname && cLast && namesMatch(cLast, surname));
    const dobMatch = Boolean(dob && c.birthDate === dob);

    if (!level && nameMatch && dobMatch) {
      level = "high";
      reasons.push("نام و تاریخ تولد مطابقت دارند");
    } else if (!level && nameMatch) {
      level = "medium";
      reasons.push("نام مشابه است");
    } else if (!level && dobMatch && surname && cLast && namesMatch(cLast, surname)) {
      level = "high";
      reasons.push("نام خانوادگی و تاریخ تولد مطابقت دارند");
    } else if (!level && dobMatch) {
      level = "low";
      reasons.push("تاریخ تولد یکسان است");
    }

    if (nationalId) {
      const customIds = Object.values(c.customValues ?? {}).map((v) => String(v).toUpperCase().replace(/[\s\-\/.]/g, ""));
      if (customIds.includes(nationalId)) {
        level = level && LEVEL_ORDER[level] >= LEVEL_ORDER.exact ? level : "exact";
        reasons.push("شماره ملی/تذکره یکسان است");
      }
    }

    if (level) {
      matches.push({ customer: c, level, reasons });
    }
  }

  return matches.sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level]).slice(0, limit);
}

/** Compare extracted values with an existing customer — for the diff view. */
export interface FieldDiff {
  field: CanonicalField;
  extracted: string | null;
  existing: string | null;
  conflict: boolean;
}

export function diffWithCustomer(
  fields: Partial<Record<CanonicalField, ExtractedValue>>,
  customer: Customer,
): FieldDiff[] {
  const map: Array<[CanonicalField, string | null | undefined]> = [
    ["documentNumber", customer.passportNo],
    ["dateOfBirth", customer.birthDate],
    ["dateOfExpiry", customer.passportExpiryDate],
  ];
  const out: FieldDiff[] = [];
  for (const [field, existing] of map) {
    const ex = fields[field]?.value;
    if (ex == null && existing == null) continue;
    const exStr = String(ex ?? "").toUpperCase();
    const oldStr = String(existing ?? "").toUpperCase();
    out.push({
      field,
      extracted: ex == null ? null : String(ex),
      existing: existing ?? null,
      conflict: Boolean(exStr && oldStr && exStr !== oldStr),
    });
  }
  return out;
}
