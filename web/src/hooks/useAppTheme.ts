import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "fud_theme";
const EVENT = "fud-theme-change";

// Theme is backed by an EXTERNAL store (localStorage) read via useSyncExternalStore.
// Every consumer (page, ThemeToggle, …) shares the same value, so the toggle updates
// the whole app at once — no per-component useState drift. Server snapshot = "dark"
// (the demo hero look); the client reconciles to a saved "light" without a hydration
// mismatch, and there is no setState-in-effect (clean under react-hooks lint).

function getSnapshot(): Theme {
  return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
}

function getServerSnapshot(): Theme {
  return "dark";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange); // cross-tab sync
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useAppTheme(): { theme: Theme; toggle: () => void; dk: boolean } {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(EVENT)); // notify every subscriber in this tab
  };

  return { theme, toggle, dk: theme === "dark" };
}
