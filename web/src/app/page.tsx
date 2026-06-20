"use client";

import { useEffect, useRef, useState } from "react";
import { useAppTheme } from "@/hooks/useAppTheme";
import ThemeToggle from "@/components/ThemeToggle";
import MarketCard from "@/components/MarketCard";
import { readMarkets, usd, MARKET_ADDRESS, EXPLORER, type Market } from "@/lib/arc";
import { SEED_META, fetchRemoteMeta, pythIdsOf, type MarketMeta } from "@/lib/marketMeta";
import { fetchPythLatestMany, type PythPrice } from "@/lib/pyth";

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function Home() {
  const { dk } = useAppTheme();
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));
  const [prices, setPrices] = useState<Record<string, PythPrice>>({});
  const [meta, setMeta] = useState<Record<number, MarketMeta>>(SEED_META);
  const metaRef = useRef<Record<number, MarketMeta>>(SEED_META);

  useEffect(() => {
    let alive = true;
    const loadMarkets = async () => {
      try {
        const m = await readMarkets();
        if (alive) {
          setMarkets(m);
          setError(null);
        }
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to read Arc");
      }
    };
    const loadMeta = async () => {
      const remote = await fetchRemoteMeta();
      const merged = Object.keys(remote).length ? { ...SEED_META, ...remote } : SEED_META;
      metaRef.current = merged;
      if (alive) setMeta(merged);
    };
    const loadPrices = async () => {
      const p = await fetchPythLatestMany(pythIdsOf(metaRef.current));
      if (alive && Object.keys(p).length) setPrices((prev) => ({ ...prev, ...p }));
    };
    loadMarkets();
    loadMeta().then(loadPrices);
    const poll = setInterval(loadMarkets, 15_000);
    const metaPoll = setInterval(loadMeta, 30_000);
    const pricePoll = setInterval(loadPrices, 10_000);
    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(metaPoll);
      clearInterval(pricePoll);
      clearInterval(tick);
    };
  }, []);

  const sorted = markets ? [...markets].sort((a, b) => b.id - a.id) : null;
  const creatorEarned = (markets ?? []).reduce(
    (s, m) => (m.outcome === 1 || m.outcome === 2 ? s + (m.fee * BigInt(2000)) / BigInt(10000) : s),
    BigInt(0),
  );
  const muted = dk ? "text-white/40" : "text-gray-400";
  const label = `text-[10px] font-black uppercase tracking-[0.18em] ${dk ? "text-white/30" : "text-gray-400"}`;

  return (
    <main className={`min-h-dvh ${dk ? "bg-[#0A0A0A] text-white" : "bg-white text-gray-900"}`}>
      <div className="mx-auto max-w-2xl px-5 py-12">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-[40px] font-black tracking-[-0.04em] leading-none select-none">
            FUD<span className="text-emerald-400">.</span>
          </span>
          <ThemeToggle />
        </div>

        <h1 className="mt-6 text-[24px] sm:text-[30px] font-black leading-[1.1] tracking-tight">
          Social calls become <span className="text-emerald-400">P2P</span> markets on{" "}
          <span className="text-emerald-400">Arc</span>.
        </h1>
        <p className={`mt-3 text-[13px] leading-relaxed ${dk ? "text-white/50" : "text-gray-600"}`}>
          An agent turns a Telegram call into a USDC conviction market — open, take the other side,
          resolve, pay out — all on-chain. The creator who made the call earns a cut.
        </p>

        {/* Contract chip */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${dk ? "bg-white/[0.04] border border-white/10" : "bg-gray-100 border border-gray-200"}`}>
            Arc testnet · USDC-native
          </span>
          <a
            href={`${EXPLORER}/address/${MARKET_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-[11px] font-mono px-3 py-1 rounded-full transition ${dk ? "bg-white/[0.04] border border-white/10 hover:bg-white/[0.10] text-white/70" : "bg-gray-100 border border-gray-200 hover:bg-gray-200 text-gray-600"}`}
          >
            {shortAddr(MARKET_ADDRESS)} ↗
          </a>
          {creatorEarned > BigInt(0) && (
            <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${dk ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300" : "bg-emerald-50 border border-emerald-200 text-emerald-700"}`}>
              💸 Creators earned ${usd(creatorEarned)}
            </span>
          )}
        </div>

        {/* Markets */}
        <h2 className={`mt-10 ${label}`}>Markets on-chain</h2>

        <div className="mt-4 space-y-2.5">
          {error && (
            <div className={`rounded-2xl border p-4 text-[12px] ${dk ? "border-red-500/30 bg-red-500/[0.06] text-red-300" : "border-red-200 bg-red-50 text-red-700"}`}>
              Couldn&apos;t reach Arc RPC: {error}
            </div>
          )}

          {!error && sorted === null && (
            <div className={`rounded-2xl border p-4 text-[12px] ${dk ? "border-white/8 bg-white/[0.03] text-white/40" : "border-gray-200 bg-gray-50 text-gray-400"}`}>
              Reading markets from Arc…
            </div>
          )}

          {!error && sorted !== null && sorted.length === 0 && (
            <div className={`rounded-2xl border p-4 text-[12px] ${dk ? "border-white/8 bg-white/[0.03] text-white/40" : "border-gray-200 bg-gray-50 text-gray-400"}`}>
              No markets yet — open one from the Telegram bot.
            </div>
          )}

          {sorted?.map((m, i) => {
            const mm = meta[m.id] ?? null;
            const live = mm?.pythId ? prices[mm.pythId.replace(/^0x/, "")] ?? null : null;
            return (
              <MarketCard key={m.id} market={m} meta={mm} live={live} now={now} dk={dk} index={i} />
            );
          })}
        </div>

        {/* How it works */}
        <h2 className={`mt-12 ${label}`}>How it works</h2>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {[
            { n: "01", t: "Call", d: "Someone posts a trade call in Telegram." },
            { n: "02", t: "Market", d: "The agent opens a P2P USDC market on Arc." },
            { n: "03", t: "Settle", d: "It resolves on-chain; the creator earns a cut." },
          ].map((s) => (
            <div
              key={s.n}
              className={`rounded-2xl border p-4 ${dk ? "border-white/8 bg-white/[0.03]" : "border-gray-200 bg-gray-50"}`}
            >
              <div className={`text-[11px] font-mono ${muted}`}>{s.n}</div>
              <div className="mt-1 text-[13px] font-black">{s.t}</div>
              <div className={`mt-1 text-[12px] leading-relaxed ${dk ? "text-white/50" : "text-gray-600"}`}>
                {s.d}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className={`mt-12 border-t pt-6 text-[11px] ${dk ? "border-white/[0.06] text-white/30" : "border-gray-200 text-gray-400"}`}>
          FUD is live on Base · this is the Arc build · resolved by GenLayer ·{" "}
          <a className="underline hover:no-underline" href="https://github.com/theboyplunger0x/fud-arc" target="_blank" rel="noopener noreferrer">
            open-source
          </a>
        </div>
      </div>
    </main>
  );
}
