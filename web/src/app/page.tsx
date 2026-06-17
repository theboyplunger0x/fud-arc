"use client";

import { useEffect, useState } from "react";
import { useAppTheme } from "@/hooks/useAppTheme";
import ThemeToggle from "@/components/ThemeToggle";
import { readMarkets, usd, MARKET_ADDRESS, EXPLORER, type Market } from "@/lib/arc";

type Tone = "long" | "short" | "neutral";

function statusOf(m: Market, now: number): { label: string; tone: Tone; live: boolean } {
  if (m.outcome === 1) return { label: "LONG won", tone: "long", live: false };
  if (m.outcome === 2) return { label: "SHORT won", tone: "short", live: false };
  if (m.outcome === 3) return { label: "DRAW", tone: "neutral", live: false };
  if (now < m.closesAt) return { label: "LIVE", tone: "neutral", live: true };
  return { label: "CLOSED · awaiting resolve", tone: "neutral", live: false };
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function timeLeft(closesAt: number, now: number): string {
  const s = closesAt - now;
  if (s <= 0) return "closed";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m left`;
  if (m > 0) return `${m}m ${s % 60}s left`;
  return `${s}s left`;
}

export default function Home() {
  const { dk } = useAppTheme();
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let alive = true;
    const load = async () => {
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
    load();
    const poll = setInterval(load, 15_000);
    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  const sorted = markets ? [...markets].sort((a, b) => b.id - a.id) : null;
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

          {sorted?.map((m) => {
            const st = statusOf(m, now);
            const total = m.longPool + m.shortPool;
            const toneText =
              st.tone === "long" ? "text-emerald-400" : st.tone === "short" ? "text-red-400" : muted;
            const toneChip =
              st.tone === "long"
                ? dk
                  ? "text-emerald-300 bg-emerald-500/20"
                  : "text-emerald-700 bg-emerald-100"
                : st.tone === "short"
                  ? dk
                    ? "text-red-300 bg-red-500/20"
                    : "text-red-700 bg-red-100"
                  : dk
                    ? "text-white/60 bg-white/10"
                    : "text-gray-600 bg-gray-100";

            return (
              <div
                key={m.id}
                className={`rounded-2xl border p-4 transition ${dk ? "border-white/8 bg-white/[0.03] hover:border-white/14" : "border-gray-200 bg-gray-50 hover:border-gray-300"}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[14px] font-black tracking-tight">Market #{m.id}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full inline-flex items-center gap-1.5 ${toneChip}`}>
                      {st.live && <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                      {st.label}
                    </span>
                  </div>
                  <span className={`text-[11px] font-mono tabular-nums ${muted}`}>
                    {m.outcome === 0 ? timeLeft(m.closesAt, now) : `$${usd(total)} pool`}
                  </span>
                </div>

                {/* Pools bar */}
                <div className="mt-3 flex items-center gap-3">
                  <span className="text-[12px] font-mono tabular-nums text-emerald-400 w-20">
                    L ${usd(m.longPool)}
                  </span>
                  <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${dk ? "bg-white/[0.06]" : "bg-gray-200"}`}>
                    <div
                      className="h-full bg-emerald-400/70"
                      style={{
                        width: `${Number(total) > 0 ? (Number(m.longPool) / Number(total)) * 100 : 50}%`,
                      }}
                    />
                  </div>
                  <span className="text-[12px] font-mono tabular-nums text-red-400 w-20 text-right">
                    ${usd(m.shortPool)} S
                  </span>
                </div>

                <div className={`mt-3 flex items-center justify-between text-[11px] ${muted}`}>
                  <span className="font-mono">opener {shortAddr(m.opener)}</span>
                  <span className={m.outcome !== 0 ? toneText : ""}>
                    {m.outcome !== 0 ? `fee $${usd(m.fee)} · creator cut` : "fee skimmed on resolve"}
                  </span>
                </div>
              </div>
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
