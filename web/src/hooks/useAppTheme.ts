import { useState, useEffect } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "fud_theme";

/**
 * App theme (dark / light) persisted in localStorage.
 * Demo default = dark (FUD's hero look). localStorage is read in an effect (not
 * the useState initializer) so server and first client render agree — no
 * hydration mismatch; a saved "light" preference is applied right after mount.
 */
export function useAppTheme(): {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
  dk: boolean;
} {
  const [theme, setTheme] = useState<Theme>("dark");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") setTheme(saved);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, theme);
  }, [theme, hydrated]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return { theme, setTheme, toggle, dk: theme === "dark" };
}
