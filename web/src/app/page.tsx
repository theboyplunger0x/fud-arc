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
  // Only markets we can label (seed / RESCUE / bot-registry meta) — hide bare "Market #N".
  const labeled = sorted?.filter((m) => meta[m.id]) ?? null;
  const openCount = labeled?.filter((m) => isOpenMarket(m, now)).length ?? 0;
  const closedCount = labeled ? labeled.length - openCount : 0;
  const visible = labeled?.filter((m) => (marketView === "open" ? isOpenMarket(m, now) : !isOpenMarket(m, now))) ?? null;
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
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="text-[24px] font-black tracking-[-0.03em] leading-none select-none">
              FUD<span className="text-emerald-400">.</span>
            </span>
            <a
              href="https://t.me/FudArcBot"
              target="_blank"
              rel="noopener noreferrer"
              className={`group inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-[13px] font-bold transition ${dk ? "border-emerald-500/30 bg-emerald-500/[0.10] text-emerald-300 hover:bg-emerald-500/[0.16]" : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
            >
              <span>📣</span>
              <span>Click here to open a call from Telegram</span>
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </a>
          </div>
          <div className="flex items-center gap-2.5">
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

        {/* Big clarity banner — these are REAL, tradeable, on-chain markets you can open yourself */}
        <div className={`mt-6 rounded-2xl border p-4 sm:p-5 ${dk ? "border-emerald-500/25 bg-emerald-500/[0.07]" : "border-emerald-200 bg-emerald-50"}`}>
          <p className="text-[18px] sm:text-[26px] font-black leading-[1.15] tracking-tight">
            These markets are <span className="text-emerald-400">real</span> and <span className="text-emerald-400">tradeable</span> — and you can open your own.
          </p>
          <p className={`mt-2 text-[12px] sm:text-[14px] leading-relaxed ${dk ? "text-white/60" : "text-gray-600"}`}>
            Open one straight from <span className="font-bold">Telegram</span> — no wallet, nothing to sign. Anyone connects a wallet and takes the other side, and every bet, payout and resolution happens <span className="font-bold">on-chain on Arc</span>.
          </p>
        </div>

        {/* Quick-links — jump to sections (x402 stays discoverable without a noisy sticky bar) */}
        <div className="mt-5 flex flex-wrap items-center gap-1.5 text-[12px] font-bold">
          <a href="#markets" className={`px-3 py-1.5 rounded-lg transition ${dk ? "text-white/55 hover:text-white hover:bg-white/[0.06]" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"}`}>Markets</a>
          <a href="#x402" className={`px-3 py-1.5 rounded-lg transition ${dk ? "text-emerald-300 hover:bg-emerald-500/[0.12]" : "text-emerald-700 hover:bg-emerald-50"}`}>x402</a>
          <a href="#how-it-works" className={`px-3 py-1.5 rounded-lg transition ${dk ? "text-white/55 hover:text-white hover:bg-white/[0.06]" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"}`}>How it works</a>
          <a href="#founder" className={`px-3 py-1.5 rounded-lg transition ${dk ? "text-white/55 hover:text-white hover:bg-white/[0.06]" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"}`}>Founder</a>
        </div>

        {/* Markets (main) + sidebar: live calls + creator payouts */}
        <div id="markets" className="mt-8 scroll-mt-20 flex flex-col lg:flex-row gap-6">
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
            <CreatorFeesViewer markets={markets ?? []} meta={meta} dk={dk} />
            <MessagesFeed markets={markets ?? []} meta={meta} now={now} dk={dk} />
            <FxStrip dk={dk} />
          </aside>
        </div>

        {/* x402 — FudAgent is also an agent that GETS PAID (RFB #1): agent-readable paid signals */}
        <h2 id="x402" className={`mt-12 scroll-mt-20 ${label}`}>Agent API · x402</h2>
        <div className={`mt-4 rounded-2xl border p-5 sm:p-6 ${dk ? "border-emerald-500/25 bg-emerald-500/[0.05]" : "border-emerald-200 bg-emerald-50/70"}`}>
          <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-8">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[18px]">🤖</span>
                <h3 className="text-[16px] sm:text-[20px] font-black tracking-tight">
                  <span className="text-emerald-400">FudAgent</span> gets paid by other agents.
                </h3>
              </div>
              <p className={`mt-2 text-[12px] sm:text-[13px] leading-relaxed ${dk ? "text-white/60" : "text-gray-600"}`}>
                Other agents pay a <span className="font-bold">0.001 USDC</span> nanopayment via{" "}
                <span className="font-bold">x402</span> to read these live signals — verified by a real
                on-chain USDC transfer on Arc. It doesn&apos;t just pay agents, it gets paid by them.
              </p>
            </div>
            <div className="flex flex-col gap-2 lg:w-[300px] shrink-0">
              <a
                href="https://fud-arc-hackaton.vercel.app/api/agent/signals"
                target="_blank"
                rel="noopener noreferrer"
                className={`group inline-flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 font-mono text-[12px] transition ${dk ? "border-white/10 bg-black/30 text-emerald-300 hover:bg-black/50" : "border-gray-200 bg-white text-emerald-700 hover:bg-gray-50"}`}
              >
                <span>GET /api/agent/signals</span>
                <span className="text-[11px] opacity-70 transition-transform group-hover:translate-x-0.5">402 ↗</span>
              </a>
              <a
                href={`${EXPLORER}/tx/0x1996ae10abd0aa6541ce396ec9581e4d667b5185a39ee4b9872927889ecda2ed`}
                target="_blank"
                rel="noopener noreferrer"
                className={`text-[11px] font-semibold ${dk ? "text-white/45 hover:text-white/70" : "text-gray-400 hover:text-gray-600"}`}
              >
                ✓ see a real settle on arcscan ↗
              </a>
            </div>
          </div>
        </div>

        {/* How it works */}
        <h2 id="how-it-works" className={`mt-12 scroll-mt-20 ${label}`}>How it works</h2>
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

        {/* The founder */}
        <h2 id="founder" className={`mt-12 scroll-mt-20 ${label}`}>The founder</h2>
        <div className={`mt-4 flex items-center gap-4 rounded-2xl border p-4 sm:p-5 ${dk ? "border-white/8 bg-white/[0.03]" : "border-gray-200 bg-gray-50"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/founder.jpg"
            alt="Marcos Lanzani"
            className={`h-16 w-16 sm:h-20 sm:w-20 rounded-xl object-cover object-top shrink-0 ${dk ? "bg-white/[0.06]" : "bg-gray-200"}`}
          />
          <div className="min-w-0">
            <div className="text-[15px] sm:text-[17px] font-black">Marcos Lanzani</div>
            <div className={`mt-1 text-[12px] sm:text-[13px] leading-relaxed ${dk ? "text-white/60" : "text-gray-600"}`}>
              <span className="font-bold">Founder &amp; solo builder of FUD.</span>
              <br />
              Building the product. Growing the community. Shipping in public.
            </div>
            <a
              href="https://x.com/theboymarc0x"
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-2 inline-flex items-center gap-1 text-[12px] font-bold ${dk ? "text-emerald-300 hover:text-emerald-200" : "text-emerald-700 hover:text-emerald-600"}`}
            >
              @theboymarc0x ↗
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className={`mt-12 border-t pt-6 text-[11px] ${dk ? "border-white/[0.06] text-white/30" : "border-gray-200 text-gray-400"}`}>
          FUD is live on Base · this is the Arc build · resolved by GenLayer with Pyth fallback · multi-currency via StableFX ·{" "}
          <a className="underline hover:no-underline" href="https://github.com/theboyplunger0x/fud-arc" target="_blank" rel="noopener noreferrer">
            open-source
          </a>
        </div>
      </div>
    </main>
  );
}
