import { useState, type ReactNode } from "react";

export interface TabItem {
  key: string;
  label: string;
  badge?: number | string;
  content: ReactNode;
}

/** iOS-style segmented glass tabs. */
export function Tabs({ tabs, initial }: { tabs: TabItem[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.key);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  return (
    <div className="flex flex-col gap-4">
      <div
        className="glass-soft flex gap-1 overflow-x-auto rounded-2xl p-1"
        role="tablist"
        aria-label="بخش‌ها"
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={active === tab.key}
            onClick={() => setActive(tab.key)}
            className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-all duration-200 ${
              active === tab.key
                ? "bg-white text-brand-600 shadow-[0_4px_14px_-4px_rgba(23,24,39,0.18)] dark:bg-white/10 dark:text-brand-300"
                : "text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200"
            }`}
          >
            {tab.label}
            {tab.badge != null && (
              <span
                className={`num rounded-full px-1.5 py-px text-[10px] ${
                  active === tab.key
                    ? "bg-brand-500/15 text-brand-600 dark:text-brand-300"
                    : "bg-ink-500/10 text-ink-500 dark:text-ink-400"
                }`}
              >
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      <div key={current?.key} className="page-enter">
        {current?.content}
      </div>
    </div>
  );
}
