"use client";

import { useEffect, useRef, useState } from "react";
import { type Market } from "@/lib/arc";
import type { MarketMeta } from "@/lib/marketMeta";
import type { PythPrice } from "@/lib/pyth";

interface Props {
  markets: Market[];
  meta: Record<number, MarketMeta>;
  prices: Record<string, PythPrice>;
}

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(5);
}

// Build the feed lines from REAL data only — market calls, pools, and live Pyth
// prices. No invented messages; with few markets it just loops the real ones.
function buildLines(markets: Market[], meta: Record<number, MarketMeta>, prices: Record<string, PythPrice>): string[] {
  const lines: string[] = [];
  const sorted = [...markets].sort((a, b) => b.id - a.id);
  for (const m of sorted) {
    const mm = meta[m.id];
    if (!mm) continue;
    const long = Number(m.longPool) / 1e6;
    const short = Number(m.shortPool) / 1e6;
    const arrow = mm.side === "long" ? "▲" : "▼";
    lines.push(mm.caller ? `@${mm.caller} called ${mm.ticker} ${mm.side.toUpperCase()} ${arrow} · ${mm.timeframe}` : `market #${m.id} · ${mm.ticker} ${mm.side.toUpperCase()} ${arrow}`);
    if (mm.call) lines.push(`  └ "${mm.call}"`);
    lines.push(`  └ pool · LONG $${long.toFixed(2)} / SHORT $${short.toFixed(2)}`);
    const live = mm.pythId ? prices[mm.pythId.replace(/^0x/, "")] ?? null : null;
    if (live) {
      const up = mm.anchor ? live.price >= mm.anchor : true;
      lines.push(`  └ ${mm.ticker} $${fmtPrice(live.price)} ${up ? "↑" : "↓"}`);
    }
  }
  if (!lines.length) lines.push("waiting for the first call —  /open @FudArcBot");
  return lines;
}

// A trading-terminal showcase: real market activity + live prices streaming by.
export default function FudTerminal({ markets, meta, prices }: Props) {
  const [shown, setShown] = useState<{ id: number; text: string }[]>([]);
  const idx = useRef(0);
  const dataRef = useRef({ markets, meta, prices });

  useEffect(() => {
    dataRef.current = { markets, meta, prices };
  }, [markets, meta, prices]);

  useEffect(() => {
    const tick = () => {
      const { markets, meta, prices } = dataRef.current;
      const pool = buildLines(markets, meta, prices);
      setShown((prev) => [...prev, { id: idx.current, text: pool[idx.current % pool.length] }].slice(-8));
      idx.current += 1;
    };
    tick();
    const t = setInterval(tick, 1700);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mt-6 rounded-xl border border-white/10 bg-[#070707] overflow-hidden font-mono shadow-lg">
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-white/[0.08]">
        <span className="w-2 h-2 rounded-full bg-red-400/70" />
        <span className="w-2 h-2 rounded-full bg-amber-400/70" />
        <span className="w-2 h-2 rounded-full bg-emerald-400/70" />
        <span className="ml-2 text-[10px] text-white/40">fud@arc — live feed</span>
      </div>
      <div className="px-3 py-2.5 h-[170px] flex flex-col justify-end overflow-hidden text-[11px] leading-relaxed">
        {shown.map((item) => (
          <div key={item.id} className="whitespace-pre text-emerald-400/90">
            <span className="text-white/25">$ </span>
            {item.text}
          </div>
        ))}
        <div className="text-emerald-400">
          <span className="text-white/25">$ </span>
          <span className="animate-pulse">▋</span>
        </div>
      </div>
    </div>
  );
}
