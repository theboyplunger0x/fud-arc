"use client";

import { type Market } from "@/lib/arc";
import type { MarketMeta } from "@/lib/marketMeta";
import { useCurrency } from "./CurrencyProvider";

interface Props {
  markets: Market[];
  meta: Record<number, MarketMeta>;
  dk: boolean;
}

// Live view of creator cuts accrued on resolved markets. Cut = fee ×
// OPENER_CUT_BPS(20%), straight from on-chain market state.
export default function CreatorFeesViewer({ markets, meta, dk }: Props) {
  const { fmt } = useCurrency();
  const rows = markets
    .filter((m) => m.outcome === 1 || m.outcome === 2)
    .sort((a, b) => b.id - a.id)
    .map((m) => ({ id: m.id, mm: meta[m.id], cut: (m.fee * BigInt(2000)) / BigInt(10000) }));

  const card = dk ? "border-white/8 bg-white/[0.03]" : "border-gray-200 bg-white shadow-sm";
  const label = dk ? "text-white/30" : "text-gray-400";
  const muted = dk ? "text-white/40" : "text-gray-500";

  return (
    <div className={`rounded-2xl border p-4 ${card}`}>
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-[12px]">💸</span>
        <span className={`text-[10px] font-black uppercase tracking-[0.18em] ${label}`}>Creator cuts</span>
      </div>
      {rows.length === 0 ? (
        <p className={`text-[11px] leading-relaxed ${muted}`}>
          Resolved calls accrue a creator cut here. Linked Telegram creators can be paid to their wallet.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.slice(0, 6).map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold truncate">
                {r.mm?.caller ? `@${r.mm.caller}` : `market #${r.id}`}
                {r.mm?.ticker && <span className={`ml-1.5 font-normal ${muted}`}>· {r.mm.ticker}</span>}
              </span>
              <span className={`text-[11px] font-black shrink-0 ${dk ? "text-emerald-300" : "text-emerald-600"}`}>+{fmt(r.cut)} accrued</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
