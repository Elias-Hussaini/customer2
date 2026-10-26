/**
 * Accounting section shell — a world of its own inside the app.
 * The main floating dock navigates HERE; this shell provides the internal
 * glass tab navigation for the accounting areas + a quick "new transaction"
 * action available on every page.
 */

import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Calculator,
  FileText,
  Landmark,
  Plus,
  Receipt,
  Scale,
  Users,
  Wallet,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { PageHeader } from "../../components/ui/StatCard";
import { TransactionFormModal } from "../../accounting/components/TransactionFormModal";

const NAV = [
  { to: "/accounting", icon: Calculator, label: "داشبورد", end: true },
  { to: "/accounting/parties", icon: Users, label: "طرف حساب‌ها", end: false },
  { to: "/accounting/transactions", icon: Receipt, label: "تراکنش‌ها", end: false },
  { to: "/accounting/accounts", icon: Wallet, label: "صندوق‌ها و بانک", end: false },
  { to: "/accounting/outstanding", icon: Scale, label: "مطالبات و بدهی", end: false },
  { to: "/accounting/documents", icon: FileText, label: "اسناد", end: false },
  { to: "/accounting/reports", icon: FileText, label: "گزارش‌ها", end: false },
  { to: "/accounting/backup", icon: Landmark, label: "پشتیبان و تنظیمات", end: false },
];

export function AccountingShell() {
  const [txModal, setTxModal] = useState(false);
  const location = useLocation();

  const subtitle = NAV.find((n) =>
    n.end ? location.pathname === n.to : location.pathname.startsWith(n.to),
  )?.label;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={Calculator}
        title="حسابداری"
        subtitle={`بخش مالی مستقل — ${subtitle ?? "مدیریت حساب‌ها و تراکنش‌ها"}`}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setTxModal(true)}>
            تراکنش جدید
          </Button>
        }
      />

      <nav
        className="glass-soft flex gap-1 overflow-x-auto rounded-2xl p-1"
        aria-label="بخش‌های حسابداری"
      >
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-all duration-200 ${
                isActive
                  ? "bg-white text-brand-600 shadow-[0_4px_14px_-4px_rgba(23,24,39,0.18)] dark:bg-white/10 dark:text-brand-300"
                  : "text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200"
              }`
            }
          >
            <item.icon size={15} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div key={location.pathname} className="page-enter">
        <Outlet />
      </div>

      <TransactionFormModal open={txModal} onClose={() => setTxModal(false)} />
    </div>
  );
}
