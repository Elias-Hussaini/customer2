/**
 * Lightweight Material-style ripple for every button-ish element — one
 * passive pointerdown listener on document, zero per-element wiring.
 *
 * The ink is clipped by a `.ripple-clip` overlay (position:absolute,
 * border-radius:inherit) so the button itself never needs overflow:hidden
 * (overflow would clip open popovers/menus rendered inside buttons).
 * Prefers-reduced-motion users get no ripple at all.
 */
export function installRipple(): void {
  if (window.__rippleInstalled) return;
  window.__rippleInstalled = true;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return;

  document.addEventListener(
    "pointerdown",
    (e) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        ".btn, .icon-btn, [data-ripple]",
      );
      if (!target || !target.isConnected) return;
      if (target instanceof HTMLElement && target.hasAttribute("disabled")) return;
      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.15;
      const clip = document.createElement("span");
      clip.className = "ripple-clip";
      const ink = document.createElement("span");
      ink.className = "ripple-ink";
      ink.style.width = `${size}px`;
      ink.style.height = `${size}px`;
      ink.style.left = `${e.clientX - rect.left - size / 2}px`;
      ink.style.top = `${e.clientY - rect.top - size / 2}px`;
      clip.appendChild(ink);
      target.appendChild(clip);
      window.setTimeout(() => clip.remove(), 700);
    },
    { passive: true },
  );
}

declare global {
  interface Window {
    __rippleInstalled?: boolean;
  }
}
