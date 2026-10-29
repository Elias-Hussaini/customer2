import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";
const STORAGE_KEY = "customer2-theme";

/* ---------------------------------------------------------------------------
 * Global theme bridge — lets code OUTSIDE the React tree (the AI agent's
 * tools, hotkeys, workers…) switch the theme. Dispatches a window event the
 * ThemeProvider applies. Exported for src/lib/agent tools.
 * ------------------------------------------------------------------------- */
export const SET_THEME_EVENT = "customer2:set-theme";

export function setThemeGlobal(theme: Theme): void {
  window.dispatchEvent(new CustomEvent(SET_THEME_EVENT, { detail: { theme } }));
}

function readInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Apply the theme class + storage + meta color (the raw side-effect). */
function applyThemeSideEffects(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage may be unavailable — theme still applies for this session */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0d0f1a" : "#f7f8fc");
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  setTheme: () => {},
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);
  /** First run applies the stored theme silently (no crossfade on load). */
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      applyThemeSideEffects(theme);
      return;
    }
    /** Animate the switch: native View Transition crossfade when available,
     *  otherwise a short global color transition (.theme-anim on <html>). */
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void> };
    };
    const reduced = prefersReducedMotion();
    if (!reduced && typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => applyThemeSideEffects(theme));
      return;
    }
    if (!reduced) {
      document.documentElement.classList.add("theme-anim");
      window.setTimeout(
        () => document.documentElement.classList.remove("theme-anim"),
        520,
      );
    }
    applyThemeSideEffects(theme);
  }, [theme]);

  // Outside callers (AI agent tools) may switch the theme at any time.
  useEffect(() => {
    const onSet = (e: Event) => {
      const t = (e as CustomEvent<{ theme?: unknown }>).detail?.theme;
      if (t === "light" || t === "dark") setThemeState(t);
    };
    window.addEventListener(SET_THEME_EVENT, onSet);
    return () => window.removeEventListener(SET_THEME_EVENT, onSet);
  }, []);

  const setTheme = (t: Theme) => setThemeState(t);
  const toggle = () => setThemeState((t) => (t === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
