"use client";

import { motion, AnimatePresence } from "framer-motion";
import { type Market } from "@/lib/arc";
import type { MarketMeta } from "@/lib/marketMeta";

interface Props {
  markets: Market[];
  meta: Record<number, MarketMeta>;
  now: number;
  dk: boolean;
}

interface Entry {
  id: string;
  ticker: string;
  side: "long" | "short";
  message: string;
  user: string;
  isOpener: boolean;
  isOpen: boolean;
}

// FUD-style tape: every call + take across markets, open messages first then closed
// (so it's never empty while any market has social). Real data only — call/take meta.
function buildEntries(markets: Market[], meta: Record<number, MarketMeta>, now: number): Entry[] {
  const out: Entry[] = [];
  for (const m of [...markets].sort((a, b) => b.id - a.id)) {
    const mm = meta[m.id];
    if (!mm) continue;
    const isOpen = m.outcome === 0 && now < m.closesAt;
    if (mm.call) {
      out.push({ id: `c${m.id}`, ticker: mm.ticker, side: mm.side, message: mm.call, user: mm.caller ?? "anon", isOpener: true, isOpen });
    }
    const takes = mm.takes ?? [];
    for (let i = 0; i < takes.length; i++) {
      out.push({ id: `t${m.id}-${i}`, ticker: mm.ticker, side: takes[i].side, message: takes[i].text, user: takes[i].user, isOpener: false, isOpen });
    }
  }
  // Open-market messages on top; closed ones fall in below (never hide them).
  return [...out.filter((e) => e.isOpen), ...out.filter((e) => !e.isOpen)];
}

export default function MessagesFeed({ markets, meta, now, dk }: Props) {
  const entries = buildEntries(markets, meta, now);

  const card = dk ? "border-white/8 bg-white/[0.03]" : "border-gray-200 bg-white shadow-sm";
  const label = dk ? "text-white/30" : "text-gray-400";
  const muted = dk ? "text-white/40" : "text-gray-500";
  const divider = dk ? "border-white/[0.06]" : "border-gray-100";
  const userColor = dk ? "text-white/30" : "text-gray-500";

  return (
    <div className={`rounded-2xl border ${card} overflow-hidden`}>
      <div className="flex items-center gap-1.5 px-4 pt-4 pb-3">
        <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className={`text-[10px] font-black uppercase tracking-[0.18em] ${label}`}>Messages</span>
      </div>
      {entries.length === 0 ? (
        <p className={`px-4 pb-4 text-[11px] leading-relaxed ${muted}`}>
          Calls and takes land here as people make them — from the Telegram bot and on-chain bets.
        </p>
      ) : (
        <div className="max-h-[460px] overflow-y-auto">
          <AnimatePresence initial={false}>
            {entries.map((e) => {
              const sideColor = e.side === "long" ? "text-emerald-400" : "text-red-400";
              const badge = e.isOpen
                ? dk ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                : dk ? "bg-white/[0.08] text-white/25" : "bg-gray-100 text-gray-400";
              const msgColor = e.isOpener
                ? dk ? "text-yellow-400/80" : "text-yellow-600"
                : dk ? "text-white/45" : "text-gray-700";
              return (
                <motion.div
                  key={e.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`px-4 py-2.5 border-b ${divider}`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`text-[11px] font-black ${sideColor}`}>{e.side === "long" ? "▲" : "▼"}</span>
                    <span className="text-[12px] font-black">{e.ticker}</span>
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${badge}`}>{e.isOpen ? "open" : "closed"}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <p className={`text-[11px] italic leading-snug flex-1 ${msgColor}`}>&ldquo;{e.message}&rdquo;</p>
                    <span className={`text-[10px] font-bold shrink-0 ${userColor}`}>{e.user}</span>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
