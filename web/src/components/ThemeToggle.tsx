"use client";
import { useAppTheme } from "@/hooks/useAppTheme";

export default function ThemeToggle() {
  const { dk, toggle } = useAppTheme();
  return (
    <button
      onClick={toggle}
      aria-label={dk ? "Switch to light" : "Switch to dark"}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border text-sm transition ${
        dk
          ? "border-white/10 bg-white/[0.04] hover:bg-white/[0.10] text-white"
          : "border-gray-200 bg-gray-100 hover:bg-gray-200 text-gray-900"
      }`}
    >
      {dk ? "☀" : "☾"}
    </button>
  );
}
