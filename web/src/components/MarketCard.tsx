"use client";

import { motion } from "framer-motion";
import { type Market } from "@/lib/arc";
import type { MarketMeta } from "@/lib/marketMeta";
import type { PythPrice } from "@/lib/pyth";
import BetPanel from "./BetPanel";
import { useCurrency } from "./CurrencyProvider";

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
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
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

function fmtTimeframe(tf: string): string {
  const t = tf.toLowerCase().trim();
  const map: Record<string, string> = { "24h": "1d", "7d": "1w" };
  return map[t] ?? t;
}

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
  const { fmt } = useCurrency();
  const isResolved = m.outcome === 1 || m.outcome === 2;
  const winner: Winner = m.outcome === 1 ? "long" : m.outcome === 2 ? "short" : null;
  const isDone = isResolved || m.outcome === 3;
  const closed = !isDone && now >= m.closesAt;

  const longNum = Number(m.longPool) / 1e6;
  const shortNum = Number(m.shortPool) / 1e6;
  const totalNum = longNum + shortNum;
  const longPct = totalNum > 0 ? (longNum / totalNum) * 100 : 50;
  const shortPct = totalNum > 0 ? (shortNum / totalNum) * 100 : 50;
  const FEE_KEEP = 0.9; // 1 - FEE_BPS/BPS (10% skimmed from the loser pool at resolve)
  const longMult = longNum > 0 ? (longNum + shortNum * FEE_KEEP) / longNum : 0;
  const shortMult = shortNum > 0 ? (shortNum + longNum * FEE_KEEP) / shortNum : 0;
  const creatorCut = (m.fee * BigInt(2000)) / BigInt(10000); // opener earns 20% of the fee

  const badge = statusBadge(m, now, winner, dk);

  const anchor = meta?.anchor;
  const livePrice = !isDone ? live?.price ?? null : null;
  const displayPrice = livePrice ?? anchor ?? null;
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
  const callerSideColor = meta?.side === "long" ? "text-emerald-400" : "text-red-400";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={`flex h-full flex-col gap-3 rounded-2xl border-2 p-4 transition-all ${isDone ? resolvedCard : card}`}
    >
      {/* HEADER */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
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
          </div>
          <span className={`mt-1.5 inline-flex items-center gap-1.5 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${badge.cls}`}>
            {badge.live && <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-current" />}
            {badge.text}
          </span>
        </div>
        <div className="text-right shrink-0 leading-tight">
          {meta?.timeframe && (
            <div className={`text-[12px] font-bold ${dk ? "text-white/60" : "text-gray-500"}`}>{fmtTimeframe(meta.timeframe)}</div>
          )}
          {!isDone && (
            <p className={`text-[10px] mt-0.5 inline-flex items-center gap-1 ${closingSoon ? "text-red-400 font-bold" : mutedTxt}`}>
              {closingSoon && <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-red-400" />}
              {closed ? "settling…" : `${timeLeft(m.closesAt, now)} left`}
            </p>
          )}
        </div>
      </div>

      {/* PRICE BOX — price + change + sparkline; entry + opener */}
      {meta && displayPrice != null && (
        <div className={`rounded-xl p-2.5 ${dk ? "bg-white/[0.03] border border-white/[0.06]" : "bg-gray-50 border border-gray-100"}`}>
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-[18px] font-black font-mono">${fmtPrice(displayPrice)}</span>
              {pct != null && (
                <span className={`text-[11px] font-bold font-mono ${up ? "text-emerald-400" : "text-red-400"}`}>
                  {up ? "↑" : "↓"} {up ? "+" : ""}{pct.toFixed(2)}%
                </span>
              )}
            </div>
            <div className="flex items-end gap-[2px] h-[16px]">
              {Array.from({ length: 16 }, (_, i) => {
                const noise = Math.sin(i * 0.8 + (anchor ?? 1) * 1000) * 0.3 + Math.cos(i * 0.5) * 0.2;
                const trend = up ? i / 16 : 1 - i / 16;
                const h = Math.max(2, Math.round((trend + noise * 0.5) * 14));
                return <div key={i} className="w-[2px] rounded-[1px]" style={{ height: h, background: up ? "#34d399" : "#f87171", opacity: 0.3 + (i / 16) * 0.7 }} />;
              })}
            </div>
          </div>
          <div className="flex items-center justify-between mt-1.5">
            {anchor != null ? (
              <div className="flex items-center gap-1.5">
                <span className={`text-[9px] font-black uppercase tracking-wider ${mutedTxt}`}>Entry</span>
                <span className={`text-[10px] font-mono ${mutedTxt}`}>${fmtPrice(anchor)}</span>
              </div>
            ) : <span />}
            {meta.caller && (
              <div className="flex items-center gap-1">
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black ${dk ? "bg-white/10 text-white/60" : "bg-gray-200 text-gray-500"}`}>
                  {meta.caller[0]?.toUpperCase()}
                </span>
                <span className={`text-[10px] font-bold ${callerSideColor}`}>
                  {meta.side === "long" ? "▲" : "▼"} {meta.caller}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CALL / MESSAGE — the thesis (no box, FUD style) */}
      {meta?.call && (
        <p className={`text-[12px] leading-snug font-bold italic ${meta.side === "long" ? (dk ? "text-emerald-400/90" : "text-emerald-600") : (dk ? "text-red-400/90" : "text-red-600")}`}>
          &ldquo;{meta.call}&rdquo;
          {meta.caller && <span className={`not-italic font-bold text-[10px] ml-1.5 ${mutedTxt}`}>— {meta.caller}</span>}
        </p>
      )}

      {/* TAKE — a participant's reaction (the social conversation) */}
      {meta?.takes?.[0] && (
        <p className={`text-[11px] leading-snug font-bold italic ${meta.takes[0].side === "long" ? (dk ? "text-emerald-400/80" : "text-emerald-600") : (dk ? "text-red-400/80" : "text-red-600")}`}>
          &ldquo;{meta.takes[0].text}&rdquo;
          <span className={`not-italic font-bold text-[10px] ml-1.5 ${mutedTxt}`}>— {meta.takes[0].user}</span>
        </p>
      )}

      {/* POOL BOX */}
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
            <span className="text-[16px] font-black">{fmt(m.shortPool)}</span>
            {!isDone && shortNum > 0 && <p className={`text-[10px] font-bold ${mutedTxt}`}>→ {shortMult.toFixed(2)}x if right</p>}
          </div>
          <div className={`text-right ${isResolved && winner === "short" ? "opacity-40" : ""}`}>
            <div className="flex items-center gap-1 justify-end">
              {winner === "long" && <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/15 px-1.5 rounded-full">winner</span>}
              <span className="text-[11px] font-black text-emerald-400">LONG ▲</span>
            </div>
            <span className="text-[16px] font-black">{fmt(m.longPool)}</span>
            {!isDone && longNum > 0 && <p className={`text-[10px] font-bold ${mutedTxt}`}>{longMult.toFixed(2)}x if right ←</p>}
          </div>
        </div>
      </div>

      {/* META ROW — volume + creator cut (RFB #6) */}
      <div className={`flex justify-between items-center text-[10px] font-bold ${mutedTxt}`}>
        <span className="tabular-nums">{fmt(m.longPool + m.shortPool)} vol</span>
        <span className={isDone && winner ? "text-emerald-400" : ""}>
          {isDone ? (winner ? `creator earned ${fmt(creatorCut)}` : "—") : "creator earns 20% of fee"}
        </span>
      </div>

      {/* push the trade buttons to the bottom */}
      <div className="flex-1" />

      {/* BET — back a side on a live market (wallet-gated, on-chain) */}
      {!isDone && !closed && <BetPanel marketId={m.id} dk={dk} longMult={longMult} shortMult={shortMult} />}
    </motion.div>
  );
}
