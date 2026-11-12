/**
 * Stage hotkeys — change a customer's visa stage from ANY list, without
 * clicking anything: hover a customer card, then tap a modifier key.
 *
 *   Ctrl        → next stage        (مرحله بعد)
 *   Alt         → previous stage    (مرحله قبل)
 *   Shift       → toggle «صادر شده»
 *   Alt+Shift   → toggle «رد شده»
 *
 * "Tap" means the modifier is pressed and released WITHOUT any other key in
 * between — so Ctrl+C (copy), Ctrl+S (save), Shift+/ (?) and other real
 * shortcuts never trigger a stage change.
 *
 * This module is framework-agnostic (one window listener, ref-counted) so
 * every customer surface — tables, card grids, request rows — can register
 * hover targets. Feedback is a small floating HUD pill (DOM-based, no React
 * lifecycle) that names the customer + the new stage in the stage's color.
 */

import {
  advanceCustomerStage,
  rewindCustomerStage,
  toggleCustomerIssued,
  toggleCustomerRejected,
  type StageChangeResult,
} from "../../db/stages";
import {
  customerStageColor,
  customerStageLabel,
} from "../../types";
import { getPrefs } from "../../db/prefs";
import type { MouseEvent } from "react";

interface HoverTarget {
  id: string;
  el: HTMLElement;
}

let hovered: HoverTarget | null = null;
let listenerCount = 0;
let detach: (() => void) | null = null;

/** Currently hovered customer (id), if any. */
export function hoveredCustomerId(): string | null {
  return hovered?.id ?? null;
}

/** Called by customer surfaces on mouseenter / mouseleave. */
export function beginCustomerHover(id: string, el: HTMLElement): void {
  hovered = { id, el };
  register();
}

export function endCustomerHover(id: string): void {
  if (hovered?.id === id) {
    hovered = null;
    unregister();
  }
}

/** Props helper — spread on any element that represents a customer. */
export function customerHoverProps(id: string): {
  onMouseEnter: (e: MouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
} {
  return {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => beginCustomerHover(id, e.currentTarget),
    onMouseLeave: () => endCustomerHover(id),
  };
}

/* ------------------------------- listeners ------------------------------- */

function onKeyDown(e: KeyboardEvent): void {
  if (e.repeat) return;
  if (e.key === "Control" || e.key === "Alt" || e.key === "Shift" || e.key === "Meta") {
    if (e.key === "Meta") return; // Cmd is an OS combinator — never a stage tap.
    // Record the full modifier combo held at this keydown (and the customer
    // under the cursor at that moment); the action fires on keyup only if no
    // other key was pressed in between AND the same customer is still hovered.
    combo = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, hoverId: hovered?.id ?? null };
    comboDirty = false;
    return;
  }
  // Any non-modifier key invalidates the pending modifier tap.
  comboDirty = true;
}

function onKeyUp(e: KeyboardEvent): void {
  if (e.key !== "Control" && e.key !== "Alt" && e.key !== "Shift") return;
  const comboSnap = combo;
  const dirty = comboDirty;
  if (dirty || !comboSnap) {
    combo = null;
    comboDirty = true;
    return;
  }
  // Other modifiers of the combo are still held (e.g. Shift released while Alt
  // stays down in an Alt+Shift tap) — wait for the LAST keyup, keep the combo.
  if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
  combo = null;
  comboDirty = true;
  // The tap only counts when the same customer stayed under the cursor.
  const target = hovered;
  if (!target || target.id !== comboSnap.hoverId) return;
  // Typing focus (inputs etc.) — never fire stage changes from a form field.
  if (e.target instanceof HTMLElement && isTypingSurface(e.target)) return;

  let action: "next" | "prev" | "issue" | "reject" | null = null;
  if (comboSnap.ctrl && !comboSnap.alt && !comboSnap.shift) action = "next";
  else if (comboSnap.alt && !comboSnap.ctrl && !comboSnap.shift) action = "prev";
  else if (comboSnap.shift && !comboSnap.ctrl) {
    action = comboSnap.alt ? "reject" : "issue";
  }
  if (!action) return;

  // Release the tap visibly even if the OS also reacts (e.g. layout switch).
  e.preventDefault();

  void (async () => {
    let result: StageChangeResult | null = null;
    try {
      // The action does not depend on prefs — run both in parallel so the
      // color lookup never delays the stage change.
      const [prefs, res] = await Promise.all([
        getPrefs(),
        action === "next"
          ? advanceCustomerStage(target.id)
          : action === "prev"
            ? rewindCustomerStage(target.id)
            : action === "issue"
              ? toggleCustomerIssued(target.id)
              : toggleCustomerRejected(target.id),
      ]);
      overridesCache = prefs.stageColors as Partial<Record<string, string>> | undefined;
      result = res;
    } catch (err) {
      console.error("[stage-hotkey] action failed:", err);
      showHud("خطا در تغییر مرحله", "#ef4444");
      return;
    }
    if (result) {
      const color = customerStageColor(result.to, overridesCache);
      showHud(`${result.customerName} — ${customerStageLabel(result.to)}`, color);
      flash(target.el, color);
    }
  })();
}

let combo: { ctrl: boolean; alt: boolean; shift: boolean; hoverId: string | null } | null = null;
let comboDirty = true;
/** Stage color overrides snapshot (refreshed per action — cheap prefs read). */
let overridesCache: Partial<Record<string, string>> | undefined;

function isTypingSurface(el: HTMLElement): boolean {
  return !!el.closest('input, textarea, select, [contenteditable="true"]');
}

function register(): void {
  if (listenerCount === 0 && !detach) {
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    detach = () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }
  listenerCount++;
}

function unregister(): void {
  listenerCount = Math.max(0, listenerCount - 1);
  if (listenerCount === 0 && detach) {
    detach();
    detach = null;
  }
}

/* ---------------------------------- HUD ---------------------------------- */

let hudEl: HTMLDivElement | null = null;
let hudTimer: ReturnType<typeof setTimeout> | null = null;

function ensureHud(): HTMLDivElement {
  if (hudEl && hudEl.isConnected) return hudEl;
  const el = document.createElement("div");
  el.dir = "rtl";
  Object.assign(el.style, {
    position: "fixed",
    bottom: "calc(96px + env(safe-area-inset-bottom))",
    left: "50%",
    transform: "translateX(-50%) translateY(8px)",
    zIndex: "9999",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "9px 16px",
    borderRadius: "999px",
    background: "rgba(17, 24, 39, 0.92)",
    color: "#f9fafb",
    fontFamily: "inherit",
    fontSize: "12.5px",
    fontWeight: "700",
    lineHeight: "1",
    boxShadow: "0 12px 32px -8px rgba(0,0,0,0.45)",
    border: "1px solid rgba(255,255,255,0.14)",
    pointerEvents: "none",
    opacity: "0",
    transition: "opacity 160ms ease, transform 160ms ease",
    maxWidth: "min(88vw, 480px)",
    whiteSpace: "nowrap",
    overflow: "hidden",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  hudEl = el;
  return el;
}

function showHud(text: string, color: string): void {
  const el = ensureHud();
  const dot = `<span style="width:10px;height:10px;border-radius:999px;background:${color};box-shadow:0 0 0 3px ${color}40;flex:0 0 auto"></span>`;
  el.innerHTML = `${dot}<span style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(text)}</span>`;
  el.style.opacity = "1";
  el.style.transform = "translateX(-50%) translateY(0)";
  if (hudTimer) clearTimeout(hudTimer);
  hudTimer = setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateX(-50%) translateY(8px)";
  }, 1500);
}

function flash(anchor: HTMLElement, color: string): void {
  const prev = anchor.style.boxShadow;
  const prevTransition = anchor.style.transition;
  anchor.style.transition = "box-shadow 220ms ease";
  anchor.style.boxShadow = `0 0 0 2.5px ${color}, 0 0 18px -2px ${color}`;
  setTimeout(() => {
    anchor.style.boxShadow = prev;
    setTimeout(() => {
      anchor.style.transition = prevTransition;
    }, 240);
  }, 380);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
