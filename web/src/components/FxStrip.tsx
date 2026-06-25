"use client";

import { useCurrency } from "./CurrencyProvider";
import { FUNDING_CURRENCIES, perUsdc } from "@/lib/currency";

// StableFX live-rate panel — what 1 USDC buys across the funding currencies,
// powered by StableFX on Arc. Renders nothing until rates load (no placeholders).
export default function FxStrip({ dk }: { dk: boolean }) {
  const { rates } = useCurrency();

  const rows = rates
    ? FUNDING_CURRENCIES.flatMap((c) => {
        const v = perUsdc(c.code, rates);
        return v == null ? [] : [{ ...c, v }];
      })
    : [];

  if (!rows.length) return null;

  const card = dk ? "border-white/8 bg-white/[0.03]" : "border-gray-200 bg-white shadow-sm";
  const label = dk ? "text-white/30" : "text-gray-400";
  const muted = dk ? "text-white/45" : "text-gray-500";
  const valueText = dk ? "text-white/75" : "text-gray-800";

  return (
    <div className={`rounded-2xl border p-4 ${card}`}>
      <div className="flex items-center gap-1.5 mb-3">
        <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className={`text-[10px] font-black uppercase tracking-[0.18em] ${label}`}>1 USDC buys</span>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.code} className="flex items-center justify-between gap-2">
            <span className={`text-[11px] font-bold ${muted}`}>
              <span className="mr-1.5">{r.flag}</span>
              {r.label}
            </span>
            <span className={`text-[12px] font-black tabular-nums ${valueText}`}>
              {r.symbol}
              {r.v.toLocaleString("en-US", { maximumFractionDigits: r.v >= 100 ? 0 : 2 })}
            </span>
          </div>
        ))}
      </div>
      <p className={`mt-3 text-[10px] ${dk ? "text-white/25" : "text-gray-400"}`}>live via StableFX on Arc</p>
    </div>
  );
}
