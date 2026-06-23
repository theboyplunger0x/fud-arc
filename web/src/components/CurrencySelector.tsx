"use client";

import { useState } from "react";
import { useCurrency } from "./CurrencyProvider";
import { DISPLAY_CURRENCIES } from "@/lib/currency";

// Compact display-currency picker for the header. Changes how every USDC value in
// the app is shown (indicative, via live StableFX rates) — it does NOT change what
// you transact in (always USDC on-chain).
export default function CurrencySelector({ dk }: { dk: boolean }) {
  const { currency, setCurrency, rates } = useCurrency();
  const [open, setOpen] = useState(false);

  const chip = dk
    ? "border-white/10 bg-white/[0.04] hover:bg-white/[0.10] text-white"
    : "border-gray-200 bg-gray-100 hover:bg-gray-200 text-gray-900";
  const menu = dk ? "bg-[#161616] border-white/10" : "bg-white border-gray-200";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Display currency"
        className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12px] font-black transition ${chip}`}
      >
        <span className="text-[13px] leading-none">{currency.flag}</span>
        <span>{currency.label}</span>
        <span className={`text-[9px] ${dk ? "text-white/40" : "text-gray-400"}`}>▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setOpen(false)} />
          <div className={`absolute right-0 mt-1.5 z-[56] w-44 rounded-2xl border p-1 shadow-2xl ${menu}`}>
            {DISPLAY_CURRENCIES.map((c) => {
              const disabled = c.code !== "USDC" && !rates?.[c.code];
              const active = c.code === currency.code;
              return (
                <button
                  key={c.code}
                  disabled={disabled}
                  onClick={() => { setCurrency(c.code); setOpen(false); }}
                  className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12px] font-bold transition disabled:opacity-30 ${
                    active
                      ? dk ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-50 text-emerald-700"
                      : dk ? "text-white/80 hover:bg-white/[0.06]" : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <span className="text-[14px] leading-none">{c.flag}</span>
                  <span className="font-black">{c.label}</span>
                  <span className={`text-[10px] font-normal ${dk ? "text-white/30" : "text-gray-400"}`}>{c.name}</span>
                  {active && <span className="ml-auto text-[11px]">✓</span>}
                </button>
              );
            })}
            <p className={`px-2.5 pt-1.5 pb-1 text-[9px] leading-snug ${dk ? "text-white/30" : "text-gray-400"}`}>
              Display only · settles in USDC
            </p>
          </div>
        </>
      )}
    </div>
  );
}
