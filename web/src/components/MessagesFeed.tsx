"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { type Market } from "@/lib/arc";
import type { MarketMeta } from "@/lib/marketMeta";

interface Props {
  markets: Market[];
  meta: Record<number, MarketMeta>;
  dk: boolean;
}

interface Msg {
  id: number;
  text: string;
  user?: string;
  side: "long" | "short";
  ticker: string;
}

// Real messages only — the calls + takes attached to live markets (FUD's social
// layer). No fabricated content; with few calls the feed simply stays short.
function buildMessages(markets: Market[], meta: Record<number, MarketMeta>): Omit<Msg, "id">[] {
  const out: Omit<Msg, "id">[] = [];
  for (const m of [...markets].sort((a, b) => b.id - a.id)) {
    const mm = meta[m.id];
    if (!mm) continue;
    if (mm.call) out.push({ text: mm.call, user: mm.caller, side: mm.side, ticker: mm.ticker });
    for (const t of mm.takes ?? []) out.push({ text: t.text, user: t.user, side: t.side, ticker: mm.ticker });
  }
  return out;
}

// FUD-style streaming "calls" feed — message bubbles that pass by on their own.
export default function MessagesFeed({ markets, meta, dk }: Props) {
  const [shown, setShown] = useState<Msg[]>([]);
  const idx = useRef(0);
  const dataRef = useRef({ markets, meta });

  useEffect(() => {
    dataRef.current = { markets, meta };
  }, [markets, meta]);

  useEffect(() => {
    const tick = () => {
      const pool = buildMessages(dataRef.current.markets, dataRef.current.meta);
      if (!pool.length) return;
      const msg = pool[idx.current % pool.length];
      setShown((prev) => [...prev, { ...msg, id: idx.current }].slice(-5));
      idx.current += 1;
    };
    tick();
    const t = setInterval(tick, 2600);
    return () => clearInterval(t);
  }, []);

  if (!shown.length) return null; // no calls yet → don't reserve empty space

  const card = dk ? "border-white/8 bg-white/[0.03]" : "border-gray-200 bg-white shadow-sm";
  const label = dk ? "text-white/30" : "text-gray-400";
  const userText = dk ? "text-white/25" : "text-gray-400";

  return (
    <div className={`mt-6 rounded-2xl border p-4 ${card}`}>
      <div className="flex items-center gap-1.5 mb-3">
        <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className={`text-[10px] font-black uppercase tracking-[0.18em] ${label}`}>Live calls</span>
      </div>
      <div className="space-y-2 min-h-[120px]">
        <AnimatePresence mode="popLayout" initial={false}>
          {shown.map((msg) => {
            const sideStrong = msg.side === "short" ? (dk ? "text-red-400" : "text-red-500") : (dk ? "text-emerald-400" : "text-emerald-500");
            const quote = msg.side === "short" ? (dk ? "text-red-400/90" : "text-red-600") : (dk ? "text-emerald-400/90" : "text-emerald-600");
            return (
              <motion.p
                key={msg.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className={`text-[12px] leading-snug font-bold italic ${quote}`}
              >
                <span className={`not-italic font-black mr-1 ${sideStrong}`}>
                  {msg.side === "short" ? "▼" : "▲"} {msg.ticker}
                </span>
                &ldquo;{msg.text}&rdquo;
                {msg.user && <span className={`not-italic font-normal ml-1.5 text-[10px] ${userText}`}>— @{msg.user}</span>}
              </motion.p>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
