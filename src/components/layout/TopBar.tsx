import { useLocation, useNavigate } from "react-router-dom";
import { Banknote, FilePlus2, FolderPlus, Moon, Plus, Search, Sun, UserPlus, UserRoundPlus } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";
import { useCustomers, useCustomFields, useLists, useRepresentatives, useRequests, useTags } from "../../hooks/useData";
import { GlobalSearch } from "./GlobalSearch";
import { Menu, type MenuItem } from "../ui/Menu";
import { uiActions } from "./uiStore";

const SECTION_TITLES: { match: (p: string) => boolean; title: string }[] = [
  { match: (p) => p === "/", title: "داشبورد" },
  { match: (p) => p.startsWith("/lists"), title: "لیست‌ها" },
  { match: (p) => p.startsWith("/customers"), title: "مشتریان" },
  { match: (p) => p.startsWith("/representatives"), title: "نمایندگان" },
  { match: (p) => p.startsWith("/requests"), title: "درخواست‌های ویزا" },
  { match: (p) => p.startsWith("/payments"), title: "پرداخت‌ها" },
  { match: (p) => p.startsWith("/reports"), title: "گزارش‌ها" },
  { match: (p) => p.startsWith("/search"), title: "جستجو" },
  { match: (p) => p.startsWith("/archive"), title: "آرشیو" },
  { match: (p) => p.startsWith("/backup"), title: "پشتیبان‌گیری" },
  { match: (p) => p.startsWith("/settings"), title: "تنظیمات" },
];

export function TopBar() {
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const customers = useCustomers() ?? [];
  const representatives = useRepresentatives() ?? [];
  const requests = useRequests() ?? [];
  const lists = useLists() ?? [];
  const tags = useTags() ?? [];
  const customFields = useCustomFields() ?? [];

  const section = SECTION_TITLES.find((s) => s.match(location.pathname))?.title ?? "E-managment";

  const quickItems: MenuItem[] = [
    { icon: FilePlus2, label: "درخواست ویزا جدید", onClick: () => uiActions.openRequestModal() },
    { icon: UserPlus, label: "مشتری جدید", onClick: () => uiActions.openCustomerModal() },
    { icon: UserRoundPlus, label: "نماینده جدید", onClick: () => uiActions.openRepModal() },
    { icon: FolderPlus, label: "لیست جدید", onClick: () => uiActions.openListModal() },
    { icon: Banknote, label: "ثبت پرداخت", onClick: () => uiActions.openPaymentModal() },
  ];

  return (
    <header className="no-print sticky top-0 z-30 border-b border-white/40 bg-white/60 backdrop-blur-xl dark:border-white/6 dark:bg-ink-950/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        {/* Brand */}
        <button
          className="flex shrink-0 items-center gap-2.5"
          onClick={() => navigate("/")}
          aria-label="خانه"
        >
          <img
            src="icons/icon-192.png"
            alt=""
            className="h-9 w-9 rounded-[11px] shadow-[0_4px_14px_-4px_rgba(99,91,255,0.5)]"
          />
          <span className="hidden text-right leading-tight sm:block">
            <span className="block text-[13px] font-extrabold" dir="ltr">E-managment</span>
            <span className="block text-[10px] text-ink-500 dark:text-ink-400">{section}</span>
          </span>
        </button>

        {/* Global search (desktop) */}
        <GlobalSearch
          className="mx-auto hidden w-full max-w-md md:block"
          customers={customers}
          representatives={representatives}
          requests={requests}
          lists={lists}
          tags={tags}
          customFields={customFields}
        />

        <div className="mr-auto flex items-center gap-1.5 md:mr-0">
          <button
            className="icon-btn md:hidden"
            aria-label="جستجو"
            onClick={() => navigate("/search")}
          >
            <Search size={18} />
          </button>
          <button className="icon-btn" onClick={toggle} aria-label="تغییر تم">
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <Menu
            align="end"
            up={false}
            items={quickItems}
            trigger={
              <span className="btn btn-primary btn-sm !px-3.5">
                <Plus size={16} />
                <span className="hidden sm:inline">جدید</span>
              </span>
            }
          />
        </div>
      </div>
    </header>
  );
}
