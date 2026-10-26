import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { uiActions } from "./uiStore";

/** Sequences must be typed within this window (ms). */
const SEQ_TIMEOUT = 1000;

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return !!t.closest('input, textarea, select, [contenteditable="true"]');
}

function anyBlockingSurface(): boolean {
  return !!document.querySelector('[role="dialog"], [role="alertdialog"], [data-floating-panel]');
}

/** Only dialogs that are actually open (closing ones stay mounted ~200ms). */
function openDialogs(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]'),
  ).filter((d) => !d.classList.contains("pointer-events-none"));
}

/**
 * Click the primary action (btn-primary) of the topmost open dialog — or, if
 * no dialog is open, of the full-page request form. Used by Enter / Ctrl+S.
 */
export function submitTopmost(target?: HTMLElement | null): boolean {
  // document.body means "nothing focused" — still allow the submit.
  const scoped = target && target !== document.body ? target : null;
  const dialogs = openDialogs();
  if (dialogs.length > 0) {
    const top = dialogs[dialogs.length - 1];
    if (scoped && !top.contains(scoped)) return false;
    const btn = top.querySelector<HTMLButtonElement>(".btn-primary:not([disabled])");
    if (!btn) return false;
    btn.click();
    return true;
  }
  const pageForm = document.querySelector<HTMLElement>("[data-page-form]");
  if (pageForm) {
    if (scoped && !pageForm.contains(scoped)) return false;
    const btn = pageForm.querySelector<HTMLButtonElement>(".btn-primary:not([disabled])");
    if (!btn) return false;
    btn.click();
    return true;
  }
  return false;
}

function focusGlobalSearch(navigate: (to: string) => void): void {
  const el = document.querySelector<HTMLInputElement>("[data-global-search]");
  if (el && el.offsetParent !== null) {
    el.focus();
    el.select();
  } else {
    navigate("/search"); // mobile: search lives on its own page
  }
}

/**
 * Global keyboard shortcuts:
 *  - Enter saves the active form (Shift+Enter = newline, Ctrl+Enter saves from textareas)
 *  - Ctrl/Cmd+S saves the active form
 *  - Double-key sequences (physical keys — work in Persian layout too):
 *    ff new request · cc new customer · pp new payment · ss search · rr reports · dd dashboard
 *  - ? opens the shortcut tutorial (Settings)
 */
export function GlobalHotkeys() {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    const seq: { code: string; t: number }[] = [];

    const sequences: Record<string, () => void> = {
      KeyFKeyF: () => uiActions.openRequestModal(),
      KeyCKeyC: () => uiActions.openCustomerModal(),
      KeyPKeyP: () => uiActions.openPaymentModal(),
      KeySKeyS: () => focusGlobalSearch((to) => navigateRef.current(to)),
      KeyRKeyR: () => navigateRef.current("/reports"),
      KeyDKeyD: () => navigateRef.current("/"),
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // ---- Ctrl/Cmd + S → save the active form -----------------------------
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === "KeyS") {
        e.preventDefault();
        submitTopmost(e.target instanceof HTMLElement ? e.target : null);
        return;
      }

      // ---- ? → shortcut tutorial -------------------------------------------
      const isQuestion =
        e.key === "?" || e.key === "؟" || (e.code === "Slash" && e.shiftKey);
      if (isQuestion && !isTypingTarget(e.target)) {
        e.preventDefault();
        navigateRef.current("/settings?tab=shortcuts");
        return;
      }

      // ---- Enter → save -----------------------------------------------------
      if (e.key === "Enter" && !e.altKey && !e.repeat) {
        const t = e.target instanceof HTMLElement ? e.target : null;
        // Defer to an open floating panel (menu / date picker / combobox) —
        // it handles its own Enter. A dialog being open is fine: that is
        // exactly the surface whose primary button we want to click.
        if (!t || document.querySelector("[data-floating-panel]")) return;
        const tag = t.tagName;
        if (tag === "BUTTON" || tag === "A") return; // native activation
        const multiline = tag === "TEXTAREA" || t.isContentEditable;
        if (multiline && !(e.ctrlKey || e.metaKey)) return; // Enter = newline
        if (e.shiftKey) return; // Shift+Enter = forced newline
        if (submitTopmost(t)) e.preventDefault();
        return;
      }

      // ---- double-key sequences (physical keys, layout-independent) --------
      if (
        /^Key[A-Z]$/.test(e.code) &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !isTypingTarget(e.target) &&
        !anyBlockingSurface()
      ) {
        const now = Date.now();
        while (seq.length && now - seq[0].t > SEQ_TIMEOUT) seq.shift();
        seq.push({ code: e.code, t: now });
        if (seq.length > 2) seq.shift();
        if (seq.length === 2) {
          const action = sequences[seq.map((s) => s.code).join("")];
          if (action) {
            seq.length = 0;
            action();
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
