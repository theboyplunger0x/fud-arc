"use client";

import { useCurrency } from "./CurrencyProvider";
import { FUNDING_CURRENCIES, perUsdc } from "@/lib/currency";

// Ambient "1 USDC = …" live-rate ticker, powered by StableFX on Arc. Renders
// nothing until rates load, so it never shows stale or placeholder numbers.
export default function FxStrip({ dk }: { dk: boolean }) {
  const { rates } = useCurrency();
  if (!rates) return null;

  const parts = FUNDING_CURRENCIES.map((c) => {
    const v = perUsdc(c.code, rates);
    if (v == null) return null;
    const n = v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 0 : 2 });
    return `${c.symbol}${n}`;
  }).filter(Boolean);

  if (!parts.length) return null;

  return (
    <p className={`mt-3 flex flex-wrap items-center gap-x-1.5 text-[10px] font-bold ${dk ? "text-white/40" : "text-gray-500"}`}>
      <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
      <span className={dk ? "text-white/55" : "text-gray-600"}>1 USDC =</span>
      <span className="tabular-nums">{parts.join(" · ")}</span>
      <span className={dk ? "text-white/25" : "text-gray-400"}>· live via StableFX on Arc</span>
    </p>
  );
}
