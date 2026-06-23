"use client";

import { useCallback, useEffect, useState } from "react";

export interface Profile {
  handle: string;
  color: string;
}

// Avatar colors the user can pick (brand emerald first).
export const PROFILE_COLORS = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa"];

const EVENT = "fud-profile-change";
const key = (addr: string) => `fud-profile-${addr.toLowerCase()}`;

function read(addr?: string): Profile | null {
  if (!addr || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key(addr));
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && typeof p.handle === "string" && typeof p.color === "string" ? (p as Profile) : null;
  } catch {
    return null;
  }
}

/**
 * Per-wallet profile (handle + avatar color), persisted in localStorage and shared
 * across components via a custom event. MVP: local to this device. Making handles
 * visible to OTHER users on your bets needs the bot/metadata backend store.
 */
export function useProfile(address?: string) {
  // Read synchronously on first render so consumers have the profile immediately
  // (no empty-then-populate flash, and no setState-in-effect to seed forms).
  const [profile, setProfile] = useState<Profile | null>(() => read(address));

  useEffect(() => {
    const sync = () => setProfile(read(address));
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, [address]);

  const save = useCallback(
    (p: Profile) => {
      if (!address) return;
      const clean: Profile = { handle: p.handle.trim().replace(/^@/, "").slice(0, 20), color: p.color };
      try {
        if (clean.handle) localStorage.setItem(key(address), JSON.stringify(clean));
        else localStorage.removeItem(key(address));
        window.dispatchEvent(new Event(EVENT));
      } catch {
        // ignore storage failures
      }
    },
    [address],
  );

  return { profile, save };
}
