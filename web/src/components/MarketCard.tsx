"use client";

import { motion } from "framer-motion";
import { usd, type Market } from "@/lib/arc";
import type { MarketMeta } from "@/lib/marketMeta";
import type { PythPrice } from "@/lib/pyth";

interface MarketCardProps {
  market: Market;
  meta: MarketMeta | null;
  live: PythPrice | null;
  now: number; // unix seconds
  dk: boolean;
  index: number;
}

type Winner = "long" | "short" | null;

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(5);
}

function timeLeft(closesAt: number, now: number): string {
  const s = closesAt - now;
  if (s <= 0) return "closed";
  if (s >= 7 * 86400) return `${Math.floor(s / (7 * 86400))}w`;
  if (s >= 86400) return `${Math.floor(s / 86400)}d`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// Normalize the bot's timeframe labels ("15m"/"1h"/"24h"/"1w") to the FE's
// display preference (lowercase, days/weeks): 24h → 1d, 7d → 1w.
function fmtTimeframe(tf: string): string {
  const t = tf.toLowerCase().trim();
  const map: Record<string, string> = { "24h": "1d", "7d": "1w" };
  return map[t] ?? t;
}

// ── tiny status badge (LIVE / WON / LOST / DRAW / awaiting) ──
function statusBadge(market: Market, now: number, winner: Winner, dk: boolean) {
  if (winner === "long")
    return { text: "LONG won", cls: dk ? "text-emerald-400 bg-emerald-500/15" : "text-emerald-600 bg-emerald-100", live: false };
  if (winner === "short")
    return { text: "SHORT won", cls: dk ? "text-red-400 bg-red-500/15" : "text-red-600 bg-red-100", live: false };
  if (market.outcome === 3)
    return { text: "DRAW", cls: dk ? "text-sky-400 bg-sky-500/15" : "text-sky-600 bg-sky-100", live: false };
  if (now < market.closesAt)
    return { text: "LIVE", cls: dk ? "text-violet-400 bg-violet-500/15" : "text-violet-600 bg-violet-100", live: true };
  return { text: "CLOSED", cls: dk ? "text-white/50 bg-white/10" : "text-gray-600 bg-gray-100", live: false };
}

export default function MarketCard({ market: m, meta, live, now, dk, index }: MarketCardProps) {
  const isResolved = m.outcome === 1 || m.outcome === 2;
  const winner: Winner = m.outcome === 1 ? "long" : m.outcome === 2 ? "short" : null;
  const isDone = isResolved || m.outcome === 3;
  const closed = !isDone && now >= m.closesAt;

  const longNum = Number(m.longPool) / 1e6;
  const shortNum = Number(m.shortPool) / 1e6;
  const totalNum = longNum + shortNum;
  const longPct = totalNum > 0 ? (longNum / totalNum) * 100 : 50;
  const shortPct = totalNum > 0 ? (shortNum / totalNum) * 100 : 50;
  // Payout multiplier on a winning side: your stake back + the loser pool net of
  // the 10% protocol fee (FEE_BPS), pro-rata. Equal pools → 1.9x, not 2.0x.
  const FEE_KEEP = 0.9; // 1 - FEE_BPS/BPS (10% skimmed from the loser pool at resolve)
  const longMult = longNum > 0 ? (longNum + shortNum * FEE_KEEP) / longNum : 0;
  const shortMult = shortNum > 0 ? (shortNum + longNum * FEE_KEEP) / shortNum : 0;
  const creatorCut = (m.fee * BigInt(2000)) / BigInt(10000); // opener earns 20% of the fee (OPENER_CUT_BPS)

  const badge = statusBadge(m, now, winner, dk);

  // live price vs anchor (only when we know the asset + have a fresh price)
  const anchor = meta?.anchor;
  const livePrice = !isDone ? live?.price ?? null : null;
  const pct = livePrice != null && anchor ? ((livePrice - anchor) / anchor) * 100 : null;
  const up = pct != null && pct >= 0;

  const card = dk
    ? "border-white/8 bg-white/[0.03] hover:border-white/14"
    : "border-gray-200 bg-white hover:border-gray-300 shadow-sm";
  const resolvedCard =
    winner === "long"
      ? dk ? "border-emerald-500/30 bg-emerald-500/[0.04]" : "border-emerald-300 bg-emerald-50"
      : winner === "short"
        ? dk ? "border-red-500/30 bg-red-500/[0.04]" : "border-red-300 bg-red-50"
        : dk ? "border-sky-500/25 bg-sky-500/[0.04]" : "border-sky-200 bg-sky-50";

  const assetPill = meta
    ? meta.kind === "fx"
      ? dk ? "text-blue-300 bg-blue-500/15" : "text-blue-700 bg-blue-100"
      : dk ? "text-amber-300 bg-amber-500/15" : "text-amber-700 bg-amber-100"
    : "";

  const mutedTxt = dk ? "text-white/35" : "text-gray-400";
  const closingSoon = !isDone && !closed && m.closesAt - now < 120;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={`flex flex-col gap-3 rounded-2xl border-2 p-4 transition-all ${isDone ? resolvedCard : card}`}
    >
      {/* HEADER */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {meta ? (
            <span className="text-[18px] font-black leading-none tracking-tight">
              {meta.kind === "fx" ? meta.ticker : `$${meta.ticker}`}
            </span>
          ) : (
            <span className="text-[15px] font-black leading-none tracking-tight">Market #{m.id}</span>
          )}
          {meta && (
            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wide ${assetPill}`}>
              {meta.kind === "fx" ? "FX" : "CRYPTO"}
            </span>
          )}
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider inline-flex items-center gap-1.5 ${badge.cls}`}>
            {badge.live && <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-current" />}
            {badge.text}
          </span>
        </div>
        <div className="text-right shrink-0 leading-tight">
          {meta?.timeframe && (
            <div className={`text-[12px] font-bold ${dk ? "text-white/60" : "text-gray-500"}`}>{fmtTimeframe(meta.timeframe)}</div>
          )}
          {!isDone && !closed && (
            <div className={`text-[10px] font-mono tabular-nums inline-flex items-center gap-1 mt-0.5 ${closingSoon ? "text-red-400 font-bold" : mutedTxt}`}>
              {closingSoon && <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-red-400" />}
              {timeLeft(m.closesAt, now)} left
            </div>
          )}
        </div>
      </div>

      {/* PRICE HEARTBEAT — only when we know the asset */}
      {meta && (
        <div className={`rounded-xl p-2.5 ${dk ? "bg-white/[0.03] border border-white/[0.06]" : "bg-gray-50 border border-gray-100"}`}>
          {!isDone && livePrice != null ? (
            <>
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-2">
                  <span className="text-[18px] font-black font-mono">${fmtPrice(livePrice)}</span>
                  {pct != null && (
                    <span className={`text-[11px] font-bold font-mono ${up ? "text-emerald-400" : "text-red-400"}`}>
                      {up ? "↑" : "↓"} {up ? "+" : ""}{pct.toFixed(2)}%
                    </span>
                  )}
                </div>
                {/* mini sparkline (procedural, trend-tinted) */}
                <div className="flex items-end gap-[2px] h-[16px]">
                  {Array.from({ length: 16 }, (_, i) => {
                    const noise = Math.sin(i * 0.8 + (anchor ?? 1) * 1000) * 0.3 + Math.cos(i * 0.5) * 0.2;
                    const trend = up ? i / 16 : 1 - i / 16;
                    const h = Math.max(2, Math.round((trend + noise * 0.5) * 14));
                    return (
                      <div
                        key={i}
                        className="w-[2px] rounded-[1px]"
                        style={{ height: h, background: up ? "#34d399" : "#f87171", opacity: 0.3 + (i / 16) * 0.7 }}
                      />
                    );
                  })}
                </div>
              </div>
              {anchor != null && (
                <div className="mt-1 flex items-center gap-1.5">
                  <span className={`text-[9px] font-black uppercase tracking-wider ${mutedTxt}`}>Anchor</span>
                  <span className={`text-[10px] font-mono ${mutedTxt}`}>${fmtPrice(anchor)}</span>
                </div>
              )}
            </>
          ) : (
            anchor != null && (
              <div className="flex items-center justify-between">
                <div>
                  <span className={`text-[9px] font-black uppercase tracking-wider ${mutedTxt}`}>Anchor</span>
                  <p className="text-[18px] font-black font-mono">${fmtPrice(anchor)}</p>
                </div>
                {meta.side && (
                  <span className={`text-[11px] font-black uppercase ${meta.side === "long" ? "text-emerald-400" : "text-red-400"}`}>
                    opener {meta.side === "long" ? "▲ long" : "▼ short"}
                  </span>
                )}
              </div>
            )
          )}
        </div>
      )}

      {/* POOL BARS */}
      <div className={`rounded-xl p-3 space-y-2.5 ${dk ? "bg-white/[0.03]" : "bg-gray-50"}`}>
        <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
          <motion.div
            animate={{ width: `${shortPct}%` }}
            transition={{ type: "spring", stiffness: 180, damping: 22 }}
            className={`h-full rounded-l-full ${winner === "short" ? "bg-red-500" : isResolved ? "bg-red-500/30" : "bg-red-500"}`}
          />
          <motion.div
            animate={{ width: `${longPct}%` }}
            transition={{ type: "spring", stiffness: 180, damping: 22 }}
            className={`h-full rounded-r-full ${winner === "long" ? "bg-emerald-500" : isResolved ? "bg-emerald-500/30" : "bg-emerald-500"}`}
          />
        </div>
        <div className="flex justify-between items-end">
          <div className={isResolved && winner === "long" ? "opacity-40" : ""}>
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-black text-red-400">▼ SHORT</span>
              {winner === "short" && <span className="text-[9px] font-bold text-red-400 bg-red-500/15 px-1.5 rounded-full">winner</span>}
            </div>
            <span className="text-[16px] font-black">${usd(m.shortPool)}</span>
            {!isDone && shortNum > 0 && <p className={`text-[10px] font-bold ${mutedTxt}`}>→ {shortMult.toFixed(2)}x if right</p>}
          </div>
          <div className={`text-right ${isResolved && winner === "short" ? "opacity-40" : ""}`}>
            <div className="flex items-center gap-1 justify-end">
              {winner === "long" && <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/15 px-1.5 rounded-full">winner</span>}
              <span className="text-[11px] font-black text-emerald-400">LONG ▲</span>
            </div>
            <span className="text-[16px] font-black">${usd(m.longPool)}</span>
            {!isDone && longNum > 0 && <p className={`text-[10px] font-bold ${mutedTxt}`}>{longMult.toFixed(2)}x if right ←</p>}
          </div>
        </div>
      </div>

      {/* CREATOR ROW — the caller who opened the market earns the cut (the RFB #6 hook) */}
      <div className={`flex justify-between items-center gap-2 rounded-lg px-2.5 py-1.5 ${dk ? "bg-emerald-500/[0.06]" : "bg-emerald-50"}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${dk ? "text-emerald-300 bg-emerald-500/20" : "text-emerald-700 bg-emerald-100"}`}>
            creator
          </span>
          <span className={`font-mono text-[11px] font-bold ${dk ? "text-white/70" : "text-gray-700"}`}>{shortAddr(m.opener)}</span>
          {meta?.side && (
            <span className={`text-[10px] font-black ${meta.side === "long" ? "text-emerald-400" : "text-red-400"}`}>
              {meta.side === "long" ? "▲" : "▼"}
            </span>
          )}
        </div>
        <span className={`text-[11px] font-black shrink-0 ${winner ? "text-emerald-400" : dk ? "text-white/40" : "text-gray-500"}`}>
          {winner ? `earned $${usd(creatorCut)}` : isDone ? "—" : "earns 20% of fee"}
        </span>
      </div>
    </motion.div>
  );
}
