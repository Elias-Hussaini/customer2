import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  grantConsoleAccess,
  getSecuritySnapshot,
  isAnomalyArmed,
  registerAnomalyClick,
  reloadSecurityState,
  SECRET_SEQUENCE,
  SECURITY_ROUTE,
  SECURITY_STORAGE_KEY,
} from "./securityStore";
import { applySecurityCacheState, purgePwaCaches } from "../pwa/usePwaUpdate";
import { LockScreen } from "./LockScreen";

/**
 * Global security layer — mounted OUTSIDE the app shell so it covers every
 * page (including the hidden console and the accounting section).
 *
 *  - Secret combo: hold Ctrl+Alt+Shift and type 09029327968 in order →
 *    the hidden security console opens (sessionStorage grant + navigation).
 *    Detected via PHYSICAL key codes, so it works on any keyboard layout
 *    (Persian included) exactly like the app's other hotkeys.
 *  - Anomaly click trap: while armed, every user click counts; on the random
 *    15–20th click the screen locks (LockScreen) and the cache is re-purged.
 *  - Cross-tab sync: a lock/trip toggled in another tab applies here too.
 */

/** Max gap between two digits of the secret sequence (ms). */
const COMBO_GAP_MS = 4_000;

/** Physical digit code → character ("Digit5" / "Numpad5" → "5"). */
function digitFromCode(code: string): string | null {
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  return null;
}

export function SecurityLayer() {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  /* ---------------------- secret key combination ------------------------- */
  useEffect(() => {
    let buffer = "";
    let lastAt = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      const snap = getSecuritySnapshot();
      // The combo is dead while the screen is locked — the password is the
      // only way out of the trap.
      if (snap.locked) {
        buffer = "";
        return;
      }
      // All three modifiers must be held for the digit to count.
      if (!e.ctrlKey || !e.altKey || !e.shiftKey) {
        buffer = "";
        return;
      }
      const digit = digitFromCode(e.code);
      if (digit === null) {
        // Any non-digit key with the combo held restarts the sequence.
        if (["Control", "Alt", "Shift", "AltGraph", "Meta"].includes(e.key)) return;
        buffer = "";
        return;
      }
      const now = Date.now();
      if (now - lastAt > COMBO_GAP_MS) buffer = "";
      lastAt = now;
      buffer += digit;
      if (buffer.length > SECRET_SEQUENCE.length) {
        buffer = buffer.slice(-SECRET_SEQUENCE.length);
      }
      if (buffer === SECRET_SEQUENCE) {
        e.preventDefault();
        e.stopPropagation();
        buffer = "";
        grantConsoleAccess();
        navigateRef.current(SECURITY_ROUTE);
      }
    };

    // Capture phase so app hotkeys can never swallow a combo digit.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  /* --------------------------- anomaly click trap ------------------------- */
  useEffect(() => {
    // IMPORTANT: read the flag live on every click — a reload, cross-tab
    // sync or arm() may change it at any moment.
    const onClick = (e: MouseEvent) => {
      if (!isAnomalyArmed()) return;
      // Only genuine user presses on the page (primary button).
      if (e.button !== 0) return;
      if (!(e.target instanceof Node) || !document.body.contains(e.target)) return;
      // The owner's own clicks on the hidden console never count.
      if (
        e.target instanceof Element &&
        e.target.closest("[data-sec-console]")
      ) {
        return;
      }
      const tripped = registerAnomalyClick();
      if (tripped) {
        // The trap fired: make absolutely sure nothing offline remains.
        void purgePwaCaches();
        void applySecurityCacheState();
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  /* ----------------------------- cross-tab sync --------------------------- */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SECURITY_STORAGE_KEY) return;
      reloadSecurityState();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return <LockScreen />;
}
