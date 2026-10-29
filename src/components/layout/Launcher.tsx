import { useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Calculator,
  FolderArchive,
  FolderOpen,
  LayoutDashboard,
  MoreHorizontal,
  Users,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import {
  commitDrag,
  getLauncherLayout,
  nearestSlotIndex,
  previewDrop,
  subscribeLauncherLayout,
  type LauncherItem,
} from "../../lib/launcher/layoutStore";
import { uiActions, useUiStore } from "./uiStore";

/** Stored icon key → Lucide component. */
const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  lists: FolderOpen,
  customers: Users,
  reps: UserRound,
  archive: FolderArchive,
  accounting: Calculator,
};

/** Hold this long before the drag engages (ms). */
const HOLD_MS = 300;
/** Moving further than this before the hold fires = scroll/tap, not drag. */
const HOLD_SLOP_PX = 10;

interface DragSession {
  id: string;
  fromPlace: LauncherItem["place"];
  draft: LauncherItem[];
  x: number;
  y: number;
  overDock: boolean;
  dockIndex: number;
}

/** Did the drag actually change anything worth saving? */
function layoutChanged(a: LauncherItem[], b: LauncherItem[]): boolean {
  if (a.length !== b.length) return true;
  const key = (i: LauncherItem) =>
    `${i.id}:${i.place}:${i.place === "dock" ? i.order : `${(i.fx ?? 0).toFixed(3)},${(i.fy ?? 0).toFixed(3)}`}`;
  const am = new Map(a.map((i) => [i.id, key(i)]));
  for (const i of b) if (am.get(i.id) !== key(i)) return true;
  return false;
}

/**
 * Launcher — the personalizable navigation system.
 *
 * One store, two surfaces:
 *  - the glass dock at the bottom (reorder by long-press + drag),
 *  - round floating buttons pulled OUT of the dock, droppable ANYWHERE.
 *
 * Long-press ANY button → it lifts; drag it around:
 *   over the dock  → live slot preview (reorder / return to the dock)
 *   anywhere else  → it turns into a round button at the drop point.
 * A plain tap still navigates. The layout is persisted per device.
 */
export function Launcher() {
  const items = useSyncExternalStore(subscribeLauncherLayout, getLauncherLayout, getLauncherLayout);
  const location = useLocation();
  const navigate = useNavigate();
  const moreOpen = useUiStore((s) => s.moreSheet);

  const [, force] = useReducer((n: number) => n + 1, 0);
  const dragRef = useRef<DragSession | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const suppressClick = useRef(false);
  const docListeners = useRef(false);
  const dockRef = useRef<HTMLDivElement>(null);
  const preventTouch = useRef<((e: TouchEvent) => void) | null>(null);

  /* ------------------------------ drag engine ------------------------------ */

  const clearDocListeners = () => {
    docListeners.current = false;
    document.removeEventListener("pointermove", onDocMove);
    document.removeEventListener("pointerup", onDocUp);
    document.removeEventListener("pointercancel", onDocUp);
    if (preventTouch.current) {
      document.removeEventListener("touchmove", preventTouch.current);
      preventTouch.current = null;
    }
  };

  function measureDock(e: PointerEvent): { overDock: boolean; dockIndex: number } {
    const dockEl = dockRef.current;
    if (!dockEl) return { overDock: false, dockIndex: -1 };
    const r = dockEl.getBoundingClientRect();
    const overDock =
      e.clientX > r.left - 28 &&
      e.clientX < r.right + 28 &&
      e.clientY > r.top - 30 &&
      e.clientY < r.bottom + 18;
    if (!overDock) return { overDock: false, dockIndex: -1 };
    const centers = Array.from(dockEl.querySelectorAll<HTMLElement>("[data-slot]")).map((el) => {
      const er = el.getBoundingClientRect();
      return er.left + er.width / 2;
    });
    return { overDock: true, dockIndex: Math.max(0, nearestSlotIndex(centers, e.clientX)) };
  }

  function onDocMove(e: PointerEvent): void {
    const d = dragRef.current;
    if (!d) {
      // Pre-engage: moving further than the slop means scroll/tap — cancel.
      if (holdTimer.current) {
        const dx = e.clientX - startX.current;
        const dy = e.clientY - startY.current;
        if (Math.hypot(dx, dy) > HOLD_SLOP_PX) {
          clearTimeout(holdTimer.current);
          holdTimer.current = null;
          clearDocListeners();
        }
      }
      return;
    }
    const { overDock, dockIndex } = measureDock(e);
    if (overDock === d.overDock && dockIndex === d.dockIndex && d.x === e.clientX && d.y === e.clientY) return;
    d.overDock = overDock;
    d.dockIndex = dockIndex;
    d.x = e.clientX;
    d.y = e.clientY;
    d.draft = previewDrop(items, d.id, {
      overDock,
      dockIndex,
      px: e.clientX,
      py: e.clientY,
      vw: window.innerWidth,
      vh: window.innerHeight,
    });
    force();
  }

  function onDocUp(): void {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    const d = dragRef.current;
    dragRef.current = null;
    clearDocListeners();
    if (!d) return;
    if (layoutChanged(d.draft, items)) {
      commitDrag(d.draft, d.id, d.fromPlace, d.overDock);
    }
    force();
  }

  /** pointerdown on a launcher button (dock or free). */
  const onItemDown = (e: React.PointerEvent, item: LauncherItem) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    suppressClick.current = false;
    startX.current = e.clientX;
    startY.current = e.clientY;
    if (!docListeners.current) {
      docListeners.current = true;
      document.addEventListener("pointermove", onDocMove);
      document.addEventListener("pointerup", onDocUp);
      document.addEventListener("pointercancel", onDocUp);
    }
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      // Engage: lift the button. Kill page scrolling while dragging.
      preventTouch.current = (te: TouchEvent) => te.preventDefault();
      document.addEventListener("touchmove", preventTouch.current, { passive: false });
      suppressClick.current = true;
      const dockEl = dockRef.current;
      const r = dockEl?.getBoundingClientRect();
      const startsInsideDock = !!r && e.clientY > (r?.top ?? 0) - 30 && e.clientY < (r?.bottom ?? 0) + 18;
      const overDockAtStart = item.place === "dock" ? true : startsInsideDock;
      let dockIndex = -1;
      if (overDockAtStart && dockEl) {
        const centers = Array.from(dockEl.querySelectorAll<HTMLElement>("[data-slot]")).map((el) => {
          const er = el.getBoundingClientRect();
          return er.left + er.width / 2;
        });
        dockIndex = Math.max(0, nearestSlotIndex(centers, e.clientX));
      }
      dragRef.current = {
        id: item.id,
        fromPlace: item.place,
        draft: items,
        x: e.clientX,
        y: e.clientY,
        overDock: overDockAtStart,
        dockIndex,
      };
      onDocMove(e as unknown as PointerEvent);
      force();
    }, HOLD_MS);
  };

  // Safety: a drop outside our handlers (e.g. lost pointer) still cleans up.
  useEffect(() => {
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      clearDocListeners();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Tap = navigate (unless this click ends a drag). */
  const activate = (item: LauncherItem) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    navigate(item.to);
  };

  /* ------------------------------- rendering -------------------------------- */

  const drag = dragRef.current;
  const view = drag ? drag.draft : items;
  const dockItems = view.filter((i) => i.place === "dock");
  const freeItems = view.filter((i) => i.place === "free" && (!drag || i.id !== drag.id));

  const isActive = (item: LauncherItem) =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to);
  const activeIndex = dockItems.findIndex((item) => isActive(item));
  const indicatorIndex = moreOpen ? dockItems.length : activeIndex;
  const indicatorVisible = indicatorIndex >= 0;

  return (
    <>
      {/* ---- floating round buttons (pulled out of the dock) ---- */}
      <div className="launcher-free-layer no-print" aria-label="دکمه‌های شناور">
        {freeItems.map((item) => {
          const Icon = ICONS[item.icon] ?? LayoutDashboard;
          const active = isActive(item);
          return (
            <button
              key={item.id}
              type="button"
              className={`launcher-fab ${active ? "active" : ""}`}
              style={{ left: `${(item.fx ?? 0.1) * 100}%`, top: `${(item.fy ?? 0.5) * 100}%` }}
              onPointerDown={(e) => onItemDown(e, item)}
              onClick={() => activate(item)}
              aria-label={item.label}
              title={`${item.label} — برای جابه‌جایی نگه دارید و بکشید`}
            >
              <Icon size={22} strokeWidth={2.1} />
              <span className="launcher-fab-tip" aria-hidden>
                {item.label}
              </span>
              <span className="launcher-fab-ring" aria-hidden />
            </button>
          );
        })}

        {/* drop ghost — the round preview while dragging outside the dock */}
        {drag && !drag.overDock ? (
          <span
            aria-hidden
            className="launcher-ghost"
            style={{ left: drag.x, top: drag.y }}
          >
            <span className="launcher-ghost-fab">
              {(() => {
                const dragged = view.find((i) => i.id === drag.id);
                const Icon = dragged ? ICONS[dragged.icon] ?? LayoutDashboard : LayoutDashboard;
                return <Icon size={22} strokeWidth={2.1} />;
              })()}
            </span>
          </span>
        ) : null}
      </div>

      {/* ---- the dock ---- */}
      <nav className="dock-wrap no-print" aria-label="ناوبری اصلی">
        <div className="dock" role="tablist" ref={dockRef}>
          <span
            className="dock-indicator"
            aria-hidden
            style={{
              transform: `translateX(calc(-1 * ${indicatorIndex} * var(--dock-item-w)))`,
              opacity: indicatorVisible ? 1 : 0,
            }}
          />
          {dockItems.map((item) => {
            const Icon = ICONS[item.icon] ?? LayoutDashboard;
            const active = isActive(item);
            const dragged = drag?.id === item.id && drag.overDock;
            return (
              <button
                key={item.id}
                type="button"
                data-slot={item.order}
                role="tab"
                aria-selected={active}
                className={`dock-item ${active ? "active" : ""} ${dragged ? "launcher-dragging" : ""}`}
                onPointerDown={(e) => onItemDown(e, item)}
                onClick={() => activate(item)}
                aria-label={item.label}
                title={`${item.label} — برای جابه‌جایی نگه دارید و بکشید`}
              >
                <Icon className="dock-icon" size={21} strokeWidth={2.1} />
                <span className="dock-label">{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            className={`dock-item ${moreOpen ? "active" : ""}`}
            onClick={() => uiActions.setMoreSheet(true)}
            aria-label="بیشتر"
            aria-haspopup="dialog"
            title="بیشتر"
          >
            <MoreHorizontal className="dock-icon" size={21} strokeWidth={2.1} />
            <span className="dock-label">بیشتر</span>
          </button>
        </div>
      </nav>
    </>
  );
}
