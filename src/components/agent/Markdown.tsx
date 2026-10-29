/**
 * Rich markdown renderer for the AI assistant's answers.
 *
 * A small, dependency-free renderer tuned for Persian/RTL: headings with an
 * accent bar, callout-style quotes, RTL tables with sticky header row,
 * LTR code blocks, task lists, links and inline emphasis — everything the
 * agent is encouraged to produce, laid out in the app's glass style.
 */

import type { ReactNode } from "react";

/* --------------------------------- blocks ---------------------------------- */

type Block =
  | { t: "h"; level: 2 | 3 | 4; text: string }
  | { t: "p"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "quote"; text: string }
  | { t: "code"; lang?: string; body: string }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "hr" };

const isHeading = (l: string): { level: 2 | 3 | 4; text: string } | null => {
  const m = /^(#{1,4})\s+(.*)$/.exec(l);
  if (!m) return null;
  const raw = m[1].length;
  return { level: raw === 1 ? 2 : (raw as 2 | 3 | 4), text: m[2].trim() };
};

const splitRow = (l: string): string[] =>
  l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

const isTableSep = (l: string): boolean =>
  /^\s*\|?[\s:-]*-{2,}[\s:|-]*\|?\s*$/.test(l) && l.includes("-");

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") { i++; continue; }

    if (/^(---|\*\*\*|___)\s*$/.test(trimmed)) { out.push({ t: "hr" }); i++; continue; }

    const h = isHeading(trimmed);
    if (h) { out.push({ t: "h", level: h.level, text: h.text }); i++; continue; }

    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim() || undefined;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++; // closing fence
      out.push({ t: "code", lang, body: body.join("\n") });
      continue;
    }

    if (trimmed.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push({ t: "quote", text: body.join("\n").trim() });
      continue;
    }

    if (trimmed.startsWith("|") && i + 1 < lines.length && isTableSep(lines[i + 1] ?? "")) {
      const head = splitRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(splitRow(lines[i++]));
      out.push({ t: "table", head, rows });
      continue;
    }

    if (/^([-*•])\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•])\s+/.test(lines[i].trim() ?? "")) {
        const raw = lines[i].trim().replace(/^([-*•])\s+/, "");
        // task-list markers become visual chips
        const item = raw.replace(/^\[[ xX]\]\s*/, (mm) => (mm.toLowerCase().startsWith("[x") ? "✅ " : "⬜ "));
        items.push(item);
        i++;
      }
      out.push({ t: "ul", items });
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i].trim() ?? "")) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""));
        i++;
      }
      out.push({ t: "ol", items });
      continue;
    }

    // paragraph — collect until blank / next block
    const para: string[] = [line];
    i++;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (t === "" || t.startsWith("#") || t.startsWith("```") || t.startsWith(">") || t.startsWith("|") || /^([-*•])\s+/.test(t) || /^\d+[.)]\s+/.test(t) || /^(---|\*\*\*|___)\s*$/.test(t)) break;
      para.push(lines[i]);
      i++;
    }
    out.push({ t: "p", text: para.join(" ").trim() });
  }
  return out;
}

/* --------------------------------- inline ---------------------------------- */

const INLINE_RE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_|~~[^~]+~~|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  let k = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${k++}`;
    if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(<strong key={key} className="font-bold text-ink-900 dark:text-white">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("~~")) {
      out.push(<s key={key} className="opacity-60">{tok.slice(2, -2)}</s>);
    } else if (tok.startsWith("`")) {
      out.push(
        <code key={key} dir="auto" className="mx-0.5 rounded-md bg-ink-900/8 px-1.5 py-0.5 font-mono text-[0.92em] text-brand-700 dark:bg-white/12 dark:text-brand-200">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      out.push(
        lm ? (
          <a key={key} href={lm[2]} target="_blank" rel="noreferrer" className="font-semibold text-brand-600 underline decoration-brand-400/60 underline-offset-2 hover:decoration-brand-500 dark:text-brand-300">
            {lm[1]}
          </a>
        ) : tok,
      );
    } else if (tok.startsWith("http")) {
      out.push(
        <a key={key} href={tok} target="_blank" rel="noreferrer" dir="ltr" className="break-all font-semibold text-brand-600 underline underline-offset-2 dark:text-brand-300">
          {tok}
        </a>,
      );
    } else {
      out.push(<em key={key} className="italic">{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ------------------------------- the renderer ------------------------------- */

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="flex flex-col gap-2.5 text-[13.5px] leading-7 text-ink-800 dark:text-ink-100">
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.t) {
          case "hr":
            return <hr key={key} className="my-1 border-ink-900/10 dark:border-white/10" />;
          case "h":
            if (b.level === 2)
              return (
                <h2 key={key} className="mt-1 flex items-center gap-2 text-[15px] font-extrabold text-ink-900 dark:text-white">
                  <span className="h-4 w-1 rounded-full bg-gradient-to-b from-brand-500 to-[#8b5cf6]" aria-hidden />
                  {renderInline(b.text, key)}
                </h2>
              );
            if (b.level === 3)
              return (
                <h3 key={key} className="mt-0.5 text-[14px] font-bold text-ink-900 dark:text-white">
                  {renderInline(b.text, key)}
                </h3>
              );
            return (
              <h4 key={key} className="text-[13px] font-bold text-ink-800 dark:text-ink-100">
                {renderInline(b.text, key)}
              </h4>
            );
          case "p":
            return <p key={key}>{renderInline(b.text, key)}</p>;
          case "quote":
            return (
              <blockquote key={key} className="rounded-xl rounded-tr-sm border-r-[3px] border-brand-400 bg-brand-500/8 px-3 py-2 text-[13px] leading-6 text-ink-700 dark:text-ink-200">
                {renderInline(b.text, key)}
              </blockquote>
            );
          case "code":
            return (
              <pre key={key} dir="ltr" className="overflow-x-auto rounded-xl bg-ink-950/92 p-3 text-left font-mono text-[12px] leading-6 text-ink-100 dark:bg-black/40">
                {b.body}
              </pre>
            );
          case "ul":
            return (
              <ul key={key} className="flex flex-col gap-1 pr-1">
                {b.items.map((it, j) => (
                  <li key={j} className="flex items-start gap-2">
                    <span aria-hidden className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                    <span className="min-w-0 flex-1">{renderInline(it, `${key}-${j}`)}</span>
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="flex flex-col gap-1 pr-1">
                {b.items.map((it, j) => (
                  <li key={j} className="flex items-start gap-2">
                    <span aria-hidden className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500/12 text-[11px] font-bold text-brand-600 dark:text-brand-300">
                      {(j + 1).toLocaleString("fa-IR")}
                    </span>
                    <span className="min-w-0 flex-1">{renderInline(it, `${key}-${j}`)}</span>
                  </li>
                ))}
              </ol>
            );
          case "table":
            return (
              <div key={key} className="overflow-x-auto rounded-xl border border-ink-900/8 dark:border-white/10">
                <table className="w-full border-collapse text-[12.5px] leading-6">
                  <thead>
                    <tr className="bg-ink-900/4 dark:bg-white/6">
                      {b.head.map((h, j) => (
                        <th key={j} className="whitespace-nowrap border-b border-ink-900/8 px-2.5 py-2 text-right font-bold text-ink-900 dark:border-white/10 dark:text-white">
                          {renderInline(h, `${key}-h${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, j) => (
                      <tr key={j} className="odd:bg-ink-900/[0.02] dark:odd:bg-white/[0.03]">
                        {b.head.map((_, c) => (
                          <td key={c} className="border-b border-ink-900/5 px-2.5 py-1.5 align-top dark:border-white/6">
                            {renderInline(row[c] ?? "—", `${key}-${j}-${c}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
