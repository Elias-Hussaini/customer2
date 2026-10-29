/**
 * Tolerant JSON extraction & repair for AI model replies.
 *
 * Vision models sometimes wrap their JSON in prose, split it across lines,
 * truncate it mid-array (token limit), emit several bare objects, or use
 * smart quotes. These helpers slice the JSON block out of any reply and
 * repair the common breakages so a usable answer is never thrown away.
 */

/** Strip markdown fences around a reply (```json … ``` or ``` … ```). */
function unfence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1] : text;
}

/** Normalize smart quotes and Persian commas to plain JSON syntax. */
function normalizeQuotes(s: string): string {
  return s
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u060C\u066B]/g, (m) => (m === "\u060C" ? "," : "."));
}

/** Balance brackets/braces so a truncated JSON still parses.
 *  Tracks string state so brackets inside strings never count. */
export function balanceBrackets(s: string): string {
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (const ch of s) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }
  // Close an unterminated string first, then the open brackets.
  let out = s;
  if (inString) out += '"';
  // Drop a dangling partial token like `"na` before closing.
  out = out.replace(/,\s*$/, "");
  for (const open of stack.reverse()) {
    out += open === "{" ? "}" : "]";
  }
  return out;
}

/** Remove trailing commas before } or ]. */
function stripTrailingCommas(s: string): string {
  return s.replace(/,\s*([}\]])/g, "$1");
}

/** Try JSON.parse with progressively harder repairs. */
export function parseJsonLoose(raw: string): unknown {
  const attempts: string[] = [];
  let candidate = normalizeQuotes(unfence(raw)).trim();
  // Slice from the first { or [ to the last matching one on the same level.
  const firstObj = candidate.indexOf("{");
  const firstArr = candidate.indexOf("[");
  const start =
    firstArr === -1 ? firstObj : firstObj === -1 ? firstArr : Math.min(firstObj, firstArr);
  if (start > 0) {
    const lastObj = candidate.lastIndexOf("}");
    const lastArr = candidate.lastIndexOf("]");
    const end = Math.max(lastObj, lastArr);
    if (end > start) {
      attempts.push(candidate.slice(start, end + 1));
      attempts.push(balanceBrackets(candidate.slice(start, end + 1)));
    }
  }
  attempts.push(candidate);
  attempts.push(balanceBrackets(candidate));
  // Truncated tail — cut at the last complete element and close.
  const lastComplete = Math.max(
    candidate.lastIndexOf("}"),
    candidate.lastIndexOf("]"),
  );
  if (lastComplete > 0) {
    const head = candidate.slice(start >= 0 ? start : 0, lastComplete + 1);
    attempts.push(balanceBrackets(head));
  }

  for (const attempt of attempts) {
    for (const body of [attempt, stripTrailingCommas(attempt)]) {
      try {
        return JSON.parse(body);
      } catch {
        /* try the next repair */
      }
    }
  }
  throw new Error("پاسخ هوش مصنوعی قابل خواندن نبود (JSON نامعتبر).");
}

/**
 * Extract a JSON OBJECT ({…}) from a reply. Tolerates fences, prose, smart
 * quotes and truncation. Throws a Persian error when nothing usable exists.
 */
export function extractJsonObjectLoose(text: string): Record<string, unknown> {
  const parsed = parseJsonLoose(text);
  if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  // A bare array of objects? Use its first object.
  if (Array.isArray(parsed)) {
    const first = parsed.find((x) => x != null && typeof x === "object" && !Array.isArray(x));
    if (first) return first as Record<string, unknown>;
  }
  throw new Error("پاسخ هوش مصنوعی یک شیء JSON نبود.");
}

/** Regex-salvage: per-image entries like {"index":1,"slot":"passport"} out of
 *  any broken reply. Returns [] when not even one entry survives. */
export function salvageSortEntries(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const re = /\{[^{}]*?"index"\s*:\s*(\d+)[^{}]*?\}/gs;
  let m: RegExpExecArray | null;
  const source = normalizeQuotes(unfence(text));
  re.lastIndex = 0;
  while ((m = re.exec(source)) !== null) {
    try {
      const obj = JSON.parse(stripTrailingCommas(m[0])) as Record<string, unknown>;
      out.push(obj);
    } catch {
      /* skip broken entry */
    }
  }
  return out;
}

/** Regex-salvage: `"key": "value"` pairs out of a broken object reply. */
export function salvageKeyValuePairs(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const re = /"([^"\n]{1,60})"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)/g;
  let m: RegExpExecArray | null;
  const source = normalizeQuotes(unfence(text));
  re.lastIndex = 0;
  while ((m = re.exec(source)) !== null) {
    const key = m[1].trim();
    const rawVal = m[2];
    if (rawVal.startsWith('"')) {
      try {
        out[key] = JSON.parse(rawVal) as string;
      } catch {
        out[key] = rawVal.slice(1, -1);
      }
    } else if (rawVal === "true" || rawVal === "false") {
      out[key] = rawVal === "true";
    } else if (rawVal === "null") {
      out[key] = null;
    } else {
      out[key] = Number(rawVal);
    }
  }
  return out;
}
