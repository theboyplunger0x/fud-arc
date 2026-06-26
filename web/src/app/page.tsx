"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppTheme } from "@/hooks/useAppTheme";
import ThemeToggle from "@/components/ThemeToggle";
import ConnectButton from "@/components/ConnectButton";
import DepositButton from "@/components/DepositButton";
import CurrencySelector from "@/components/CurrencySelector";
import FxStrip from "@/components/FxStrip";
import MessagesFeed from "@/components/MessagesFeed";
import CreatorFeesViewer from "@/components/CreatorFeesViewer";
import { useCurrency } from "@/components/CurrencyProvider";
import MarketCard from "@/components/MarketCard";
import { readMarkets, MARKET_ADDRESS, EXPLORER, type Market } from "@/lib/arc";
import { SEED_META, fetchRemoteMeta, pythIdsOf, type MarketMeta } from "@/lib/marketMeta";
import { fetchPythLatestMany, type PythPrice } from "@/lib/pyth";

type MarketView = "open" | "closed";

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function isOpenMarket(m: Market, now: number): boolean {
  return m.outcome === 0 && now < m.closesAt;
}

function marketLivePrice(mm: MarketMeta | null, prices: Record<string, PythPrice>): PythPrice | null {
  if (!mm?.pythId) return null;
  const raw = prices[mm.pythId.replace(/^0x/, "")] ?? null;
  if (!raw) return null;
  if (!mm.invertPyth) return raw;
  return raw.price > 0 ? { ...raw, price: 1 / raw.price } : null;
}

export default function Home() {
  const { dk } = useAppTheme();
  const { fmt } = useCurrency();
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));
  const [marketView, setMarketView] = useState<MarketView>("open");
  const [prices, setPrices] = useState<Record<string, PythPrice>>({});
  const [meta, setMeta] = useState<Record<number, MarketMeta>>(SEED_META);
  const metaRef = useRef<Record<number, MarketMeta>>(SEED_META);

  const refreshMarkets = useCallback(async () => {
    try {
      const m = await readMarkets();
      setMarkets(m);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to read Arc");
    }
  }, []);

  const refreshMeta = useCallback(async () => {
    const remote = await fetchRemoteMeta();
    const merged = Object.keys(remote).length ? { ...SEED_META, ...remote } : SEED_META;
    metaRef.current = merged;
    setMeta(merged);
    return merged;
  }, []);

  const refreshBoard = useCallback(async () => {
    await refreshMarkets();
    await refreshMeta();
  }, [refreshMarkets, refreshMeta]);

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
      const merged = await refreshMeta();
      metaRef.current = merged;
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
  }, [refreshMeta]);

  const sorted = markets ? [...markets].sort((a, b) => b.id - a.id) : null;
  const openCount = sorted?.filter((m) => isOpenMarket(m, now)).length ?? 0;
  const closedCount = sorted ? sorted.length - openCount : 0;
  const visible = sorted?.filter((m) => (marketView === "open" ? isOpenMarket(m, now) : !isOpenMarket(m, now))) ?? null;
  const creatorEarned = (markets ?? []).reduce(
    (s, m) => (m.outcome === 1 || m.outcome === 2 ? s + (m.fee * BigInt(2000)) / BigInt(10000) : s),
    BigInt(0),
  );
  const muted = dk ? "text-white/40" : "text-gray-400";
  const label = `text-[10px] font-black uppercase tracking-[0.18em] ${dk ? "text-white/30" : "text-gray-400"}`;
  const sectionTitle = `text-[32px] font-black leading-[1.05] tracking-normal ${dk ? "text-white" : "text-gray-950"}`;
  const filterActive = dk ? "bg-white/12 text-white" : "bg-gray-200 text-gray-900";
  const filterInactive = dk ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-700";

  return (
    <main className={`min-h-dvh ${dk ? "bg-[#0A0A0A] text-white" : "bg-white text-gray-900"}`}>
      {/* Header bar — sticky */}
      <header className={`sticky top-0 z-20 border-b backdrop-blur-md ${dk ? "bg-[#0A0A0A]/80 border-white/[0.07]" : "bg-white/85 border-gray-200"}`}>
        <div className="mx-auto max-w-7xl px-5 h-14 flex items-center justify-between">
          <span className="text-[24px] font-black tracking-[-0.03em] leading-none select-none">
            FUD<span className="text-emerald-400">.</span>
          </span>
          <div className="flex items-center gap-2.5">
            <a
              href="https://t.me/FudArcBot"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-emerald-400 text-[#0A0A0A] text-[12px] font-black hover:bg-emerald-300 transition"
            >
              📣 Make a call
            </a>
            <CurrencySelector dk={dk} />
            <DepositButton dk={dk} />
            <ConnectButton dk={dk} markets={markets ?? []} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 pt-8 pb-12">
        <h1 className="text-[24px] sm:text-[30px] font-black leading-[1.1] tracking-tight">
          Social calls become <span className="text-emerald-400">P2P</span> markets on{" "}
          <span className="text-emerald-400">Arc</span>.
        </h1>
        <p className={`mt-3 max-w-2xl text-[13px] leading-relaxed ${dk ? "text-white/50" : "text-gray-600"}`}>
          An agent turns a Telegram call into a USDC conviction market — open, take the other side,
          resolve, pay out — all on-chain. The creator who made the call earns a cut.
        </p>

        <p className={`mt-2 text-[11px] font-semibold ${dk ? "text-white/35" : "text-gray-400"}`}>
          Anyone can call from Telegram — no wallet, no signing ↗
        </p>

        {/* Make a call (mobile only — the header has it on sm+) */}
        <a
          href="https://t.me/FudArcBot"
          target="_blank"
          rel="noopener noreferrer"
          className="sm:hidden mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-400 text-[#0A0A0A] text-[13px] font-black"
        >
          📣 Make a call →
        </a>

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
              💸 Creator cuts {fmt(creatorEarned)}
            </span>
          )}
        </div>

        {/* Markets (main) + sidebar: live calls + creator payouts */}
        <div className="mt-8 flex flex-col lg:flex-row gap-6">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className={sectionTitle}>Markets on-chain</h2>
              <div
                className={`flex items-center gap-1 rounded-2xl border p-1 ${dk ? "border-white/8 bg-white/[0.03]" : "border-gray-200 bg-gray-50"}`}
                aria-label="Market status"
              >
                {([
                  { id: "open", label: "Open", count: openCount },
                  { id: "closed", label: "Closed", count: closedCount },
                ] as const).map((view) => (
                  <button
                    key={view.id}
                    type="button"
                    aria-pressed={marketView === view.id}
                    onClick={() => setMarketView(view.id)}
                    className={`h-8 rounded-xl px-3 text-[11px] font-black transition-all ${marketView === view.id ? filterActive : filterInactive}`}
                  >
                    {view.label}
                    <span className="ml-1.5 tabular-nums opacity-70">{view.count}</span>
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className={`mt-4 rounded-2xl border p-4 text-[12px] ${dk ? "border-red-500/30 bg-red-500/[0.06] text-red-300" : "border-red-200 bg-red-50 text-red-700"}`}>
                Couldn&apos;t reach Arc RPC: {error}
              </div>
            )}

            {!error && sorted === null && (
              <div className={`mt-4 rounded-2xl border p-4 text-[12px] ${dk ? "border-white/8 bg-white/[0.03] text-white/40" : "border-gray-200 bg-gray-50 text-gray-400"}`}>
                Reading markets from Arc…
              </div>
            )}

            {!error && visible !== null && visible.length === 0 && (
              <div className={`mt-4 rounded-2xl border p-4 text-[12px] ${dk ? "border-white/8 bg-white/[0.03] text-white/40" : "border-gray-200 bg-gray-50 text-gray-400"}`}>
                {marketView === "open" ? "No open markets — make one from the Telegram bot." : "No closed markets yet."}
              </div>
            )}

            {visible && visible.length > 0 && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {visible.map((m, i) => {
                  const mm = meta[m.id] ?? null;
                  const live = marketLivePrice(mm, prices);
                  return (
                    <MarketCard
                      key={m.id}
                      market={m}
                      meta={mm}
                      live={live}
                      now={now}
                      dk={dk}
                      index={i}
                      onBetDone={refreshBoard}
                    />
                  );
                })}
              </div>
            )}
          </div>

          <aside className="lg:w-[310px] shrink-0 space-y-4">
            <MessagesFeed markets={markets ?? []} meta={meta} dk={dk} />
            <CreatorFeesViewer markets={markets ?? []} meta={meta} dk={dk} />
            <FxStrip dk={dk} />
          </aside>
        </div>

        {/* How it works */}
        <h2 className={`mt-12 ${label}`}>How it works</h2>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {[
            { n: "01", t: "Call", d: "Someone posts a call in Telegram." },
            { n: "02", t: "Market", d: "The agent opens a P2P USDC market on Arc." },
            { n: "03", t: "Settle", d: "It resolves through GenLayer over live price sources, with Pyth fallback; winners claim from escrow." },
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
          FUD is live on Base · this is the Arc build · resolved by GenLayer with Pyth fallback ·{" "}
          <a className="underline hover:no-underline" href="https://github.com/theboyplunger0x/fud-arc" target="_blank" rel="noopener noreferrer">
            open-source
          </a>
        </div>
      </div>
    </main>
  );
}
