import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { normalizeFa } from "../../utils/normalize";
import type { Tag as TagType } from "../../types";
import { createTag, TAG_PALETTE } from "../../db/taxonomy";
import { TagBadge } from "./Badges";

interface TagPickerProps {
  tags: TagType[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

/** Multi-tag selector with inline creation. */
export function TagPicker({ tags, selectedIds, onChange }: TagPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selected = selectedIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is TagType => Boolean(t));

  const filtered = tags.filter((t) => !selectedIds.includes(t.id)).filter((t) => {
    if (!query.trim()) return true;
    return normalizeFa(t.name).includes(normalizeFa(query));
  });

  const addNew = async () => {
    const name = query.trim();
    if (!name) return;
    if (tags.some((t) => normalizeFa(t.name) === normalizeFa(name))) return;
    const color = TAG_PALETTE[tags.length % TAG_PALETTE.length];
    const tag = await createTag({ name, color, isUrgent: name.includes("فوری") });
    onChange([...selectedIds, tag.id]);
    setQuery("");
  };

  return (
    <div className="relative" ref={wrapRef}>
      <div
        className={`field flex min-h-[46px] cursor-pointer flex-wrap items-center gap-1.5 ${
          open ? "border-brand-500" : ""
        }`}
        onClick={() => !open && setOpen(true)}
      >
        {selected.length === 0 && <span className="text-[13px] text-ink-400">بدون تگ</span>}
        {selected.map((tag) => (
          <TagBadge
            key={tag.id}
            tag={tag}
            onRemove={() => onChange(selectedIds.filter((id) => id !== tag.id))}
          />
        ))}
        <button
          type="button"
          className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/12 text-brand-600 dark:text-brand-300"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          aria-label="افزودن تگ"
        >
          <Plus size={14} />
        </button>
      </div>

      {open && (
        <div className="glass-strong anim-pop absolute inset-x-0 top-full z-[65] mt-2 overflow-hidden rounded-2xl">
          <div className="border-b border-ink-900/5 px-3.5 py-2.5 dark:border-white/5">
            <input
              autoFocus
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-ink-400"
              placeholder="جستجو یا ساخت تگ جدید…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && query.trim() && filtered.length === 0) {
                  e.preventDefault();
                  void addNew();
                }
              }}
            />
          </div>
          <div className="max-h-52 overflow-y-auto p-1.5">
            {filtered.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-right hover:bg-brand-500/10"
                onClick={() => {
                  onChange([...selectedIds, tag.id]);
                  setQuery("");
                }}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: tag.color }} />
                <span className="text-[13px] font-medium">{tag.name}</span>
              </button>
            ))}
            {query.trim() && filtered.length === 0 && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-right text-[13px] font-semibold text-brand-600 hover:bg-brand-500/10 dark:text-brand-300"
                onClick={() => void addNew()}
              >
                <Plus size={15} />
                ساخت تگ «{query.trim()}»
              </button>
            )}
            {!query.trim() && filtered.length === 0 && (
              <p className="px-3 py-3 text-center text-xs text-ink-400">
                همه تگ‌ها اضافه شده‌اند — با تایپ نام، تگ جدید بسازید
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
