import { useNavigate } from "react-router-dom";
import {
  Archive,
  Banknote,
  DatabaseBackup,
  FileBarChart,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { BottomSheet } from "../ui/Modal";
import { uiActions, useUiStore } from "./uiStore";

interface MoreItem {
  icon: LucideIcon;
  label: string;
  description: string;
  to: string;
  tint: string;
}

const MORE_ITEMS: MoreItem[] = [
  {
    icon: Banknote,
    label: "پرداخت‌ها",
    description: "دفتر مالی و مانده حساب",
    to: "/payments",
    tint: "bg-[#10b981]/12 text-[#0b9e6e] dark:text-[#3ddc9a]",
  },
  {
    icon: FileBarChart,
    label: "گزارش‌ها",
    description: "خروجی اکسل، PDF و تصویر",
    to: "/reports",
    tint: "bg-brand-500/12 text-brand-600 dark:text-brand-300",
  },
  {
    icon: Search,
    label: "جستجوی پیشرفته",
    description: "جستجو در همه داده‌ها",
    to: "/search",
    tint: "bg-[#3b82f6]/12 text-[#2563eb] dark:text-[#6ba3f8]",
  },
  {
    icon: Archive,
    label: "آرشیو",
    description: "رکوردهای بایگانی‌شده",
    to: "/archive",
    tint: "bg-ink-500/10 text-ink-600 dark:text-ink-300",
  },
  {
    icon: DatabaseBackup,
    label: "پشتیبان‌گیری",
    description: "خروجی و بازیابی داده‌ها",
    to: "/backup",
    tint: "bg-accent/12 text-accent",
  },
  {
    icon: Settings,
    label: "تنظیمات",
    description: "فیلدها، تگ‌ها و ظاهر",
    to: "/settings",
    tint: "bg-[#f59e0b]/14 text-[#c77d0a] dark:text-[#f5b84f]",
  },
];

/** The "More" glass bottom sheet — secondary navigation hub. */
export function MoreSheet() {
  const open = useUiStore((s) => s.moreSheet);
  const navigate = useNavigate();

  const close = () => uiActions.setMoreSheet(false);

  return (
    <BottomSheet open={open} onClose={close}>
      <div className="mb-4 text-center">
        <h2 className="text-[15px] font-extrabold">بیشتر</h2>
        <p className="text-xs text-ink-500 dark:text-ink-400">دسترسی سریع به بخش‌های دیگر</p>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {MORE_ITEMS.map((item) => (
          <button
            key={item.to}
            className="glass-soft flex flex-col items-center gap-2 rounded-2xl px-2 py-4 transition-transform active:scale-95"
            onClick={() => {
              close();
              navigate(item.to);
            }}
          >
            <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${item.tint}`}>
              <item.icon size={20} />
            </span>
            <span className="text-[11.5px] font-bold">{item.label}</span>
            <span className="text-[9.5px] leading-3 text-ink-400">{item.description}</span>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
