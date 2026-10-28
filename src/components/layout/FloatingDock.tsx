import { NavLink, useLocation } from "react-router-dom";
import {
  Calculator,
  FolderArchive,
  FolderOpen,
  LayoutDashboard,
  MoreHorizontal,
  UserRound,
  Users,
} from "lucide-react";
import { uiActions, useUiStore } from "./uiStore";

const ITEMS = [
  { to: "/", icon: LayoutDashboard, label: "داشبورد", end: true },
  { to: "/lists", icon: FolderOpen, label: "لیست‌ها", end: false },
  { to: "/customers", icon: Users, label: "مشتریان", end: false },
  { to: "/representatives", icon: UserRound, label: "نمایندگان", end: false },
  { to: "/accounting", icon: Calculator, label: "حسابداری", end: false },
  { to: "/smart-archive", icon: FolderArchive, label: "بایگانی هوشمند", end: false },
];

/**
 * Signature floating glass dock — Telegram-inspired, fixed to the bottom of
 * the viewport with a softly illuminated sliding indicator.
 */
export function FloatingDock() {
  const location = useLocation();
  const moreOpen = useUiStore((s) => s.moreSheet);

  const activeIndex = ITEMS.findIndex((item) =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
  );
  // When the More sheet is open, the indicator slides onto the More button.
  const indicatorIndex = moreOpen ? ITEMS.length : activeIndex;
  const indicatorVisible = indicatorIndex >= 0;

  return (
    <nav className="dock-wrap no-print" aria-label="ناوبری اصلی">
      <div className="dock" role="tablist">
        <span
          className="dock-indicator"
          aria-hidden
          style={{
            transform: `translateX(calc(-1 * ${indicatorIndex} * var(--dock-item-w)))`,
            opacity: indicatorVisible ? 1 : 0,
          }}
        />
        {ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `dock-item ${isActive ? "active" : ""}`}
            aria-label={item.label}
          >
            <item.icon className="dock-icon" size={21} strokeWidth={2.1} />
            <span className="dock-label">{item.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={`dock-item ${moreOpen ? "active" : ""}`}
          onClick={() => uiActions.setMoreSheet(true)}
          aria-label="بیشتر"
          aria-haspopup="dialog"
        >
          <MoreHorizontal className="dock-icon" size={21} strokeWidth={2.1} />
          <span className="dock-label">بیشتر</span>
        </button>
      </div>
    </nav>
  );
}
