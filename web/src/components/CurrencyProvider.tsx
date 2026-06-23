"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { currencyByCode, formatUnits, type CurrencyDef, type Rates } from "@/lib/currency";

interface CurrencyCtx {
  currency: CurrencyDef;
  setCurrency: (code: string) => void;
  rates: Rates | null;
  fmt: (units: bigint) => string;
}

const Ctx = createContext<CurrencyCtx | null>(null);

// Holds the selected display currency + live StableFX rates (fetched once).
// Default is USDC on both server and first client render → no hydration mismatch.
export default function CurrencyProvider({ children }: { children: ReactNode }) {
  const [code, setCode] = useState("USDC");
  const [rates, setRates] = useState<Rates | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/fx-board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: "100" }),
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !Array.isArray(d.quotes)) return;
        const next: Rates = {};
        for (const q of d.quotes) if (q.ok && q.rate) next[q.cur] = Number(q.rate);
        if (Object.keys(next).length) setRates(next);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const currency = currencyByCode(code);
  const value = useMemo<CurrencyCtx>(
    () => ({
      currency,
      setCurrency: setCode,
      rates,
      fmt: (units: bigint) => formatUnits(units, currency, rates),
    }),
    [currency, rates],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrency(): CurrencyCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
  return ctx;
}
