"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useAccount } from "wagmi";
import { FUNDING_CURRENCIES } from "@/lib/currency";

const FAUCET = "https://faucet.circle.com";

interface BoardRow {
  cur: string;
  ok: boolean;
  buyAmount?: string;
  rate?: string;
}

type Direction = "fund" | "cashout";

const n2 = (s: string) => Number(s).toLocaleString("en-US", { maximumFractionDigits: 2 });
const n4 = (s: string) => Number(s).toFixed(4);

export default function DepositModal({ dk, onClose }: { dk: boolean; onClose: () => void }) {
  const { address } = useAccount();
  const [direction, setDirection] = useState<Direction>("fund");
  const [amount, setAmount] = useState("100");
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bg = dk ? "bg-[#111] border-white/10" : "bg-white border-gray-200";
  const muted = dk ? "text-white/40" : "text-gray-400";
  const strong = dk ? "text-white" : "text-gray-900";
  const amountValid = Number(amount) > 0;
  const cashout = direction === "cashout";

  // Debounced live board: one amount → quotes for every regional currency at once.
  useEffect(() => {
    if (!(Number(amount) > 0)) return;
    let active = true;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetch("/api/fx-board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, recipient: address, direction }),
        signal: ctrl.signal,
      })
        .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
          if (!active) return;
          if (ok && Array.isArray(data.quotes)) setRows(data.quotes);
          else setError("Quotes unavailable");
        })
        .catch((e) => {
          if (active && !(e instanceof DOMException && e.name === "AbortError")) setError("Quotes unavailable");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 400);
    return () => {
      active = false;
      clearTimeout(t);
      ctrl.abort();
    };
  }, [amount, address, direction]);

  function switchTo(d: Direction) {
    if (d === direction) return;
    setDirection(d);
    setRows(null); // avoid rendering the previous direction's units while refetching
    setError(null);
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className={`relative w-full max-w-sm rounded-3xl border ${bg} shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className={`text-[16px] font-black ${strong}`}>Funding</h3>
            <button onClick={onClose} className={`text-[18px] font-bold ${muted} hover:opacity-60`}>✕</button>
          </div>
          <p className={`text-[12px] leading-relaxed mb-4 ${muted}`}>
            You&apos;re on <span className={`font-black ${dk ? "text-violet-400" : "text-violet-600"}`}>Arc testnet</span> — fund with test stablecoins, no real money.
          </p>

          {/* Faucet — the working path */}
          <a
            href={FAUCET}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full py-3 rounded-xl text-[13px] font-black text-center bg-emerald-400 text-[#0A0A0A] hover:bg-emerald-300 transition"
          >
            Get test USDC from the faucet →
          </a>
          <p className={`text-[10px] leading-relaxed mt-1.5 mb-4 ${muted}`}>
            At faucet.circle.com: pick <span className="font-bold">Arc Testnet</span> + <span className="font-bold">USDC</span>, paste your address.
          </p>

          {/* Multi-currency board — fund from / cash out to any stablecoin (live StableFX) */}
          <div className="flex items-center justify-between">
            <p className={`text-[10px] font-black uppercase tracking-widest ${muted}`}>
              {cashout ? "Cash-out quote" : "Funding quote"}
            </p>
            <span className={`text-[9px] font-bold ${dk ? "text-emerald-400/70" : "text-emerald-600/70"}`}>● live · StableFX on Arc</span>
          </div>

          {/* Direction tabs */}
          <div className={`mt-2 flex gap-1 p-1 rounded-xl ${dk ? "bg-white/[0.04]" : "bg-gray-100"}`}>
            {(["fund", "cashout"] as Direction[]).map((d) => (
              <button
                key={d}
                onClick={() => switchTo(d)}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-black transition ${
                  direction === d
                    ? dk ? "bg-white/10 text-white" : "bg-white text-gray-900 shadow-sm"
                    : dk ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-600"
                }`}
              >
                {d === "fund" ? "Fund" : "Cash out"}
              </button>
            ))}
          </div>

          <div className="relative mt-2 mb-2">
            <input
              type="number"
              inputMode="decimal"
              placeholder={cashout ? "USDC amount" : "amount"}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`w-full text-[14px] font-bold px-3 py-2.5 rounded-xl outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none ${dk ? "bg-white/[0.05] text-white placeholder:text-white/30" : "bg-gray-100 text-gray-900 placeholder:text-gray-400"}`}
            />
          </div>

          <div className={`space-y-1 transition-opacity ${loading ? "opacity-50" : "opacity-100"}`}>
            {FUNDING_CURRENCIES.map((a) => {
              const q = rows?.find((r) => r.cur === a.code);
              return (
                <div
                  key={a.code}
                  className={`flex items-center justify-between rounded-xl px-3 py-2 ${dk ? "bg-white/[0.03]" : "bg-gray-50"}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] leading-none">{a.flag}</span>
                    <div>
                      <div className={`text-[12px] font-black leading-none ${strong}`}>{a.code}</div>
                      <div className={`text-[9px] ${muted}`}>{a.name}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    {q?.ok && q.buyAmount && q.rate && Number(q.buyAmount) > 0 && Number(q.rate) > 0 ? (
                      <>
                        <div className={`text-[13px] font-black ${dk ? "text-emerald-300" : "text-emerald-700"}`}>
                          ≈ {n2(q.buyAmount)} {cashout ? a.code : "USDC"}
                        </div>
                        <div className={`text-[9px] ${muted}`}>
                          {cashout ? `1 USDC = ${n4(q.rate)} ${a.code}` : `1 ${a.code} = ${n4(q.rate)}`}
                        </div>
                      </>
                    ) : !amountValid ? (
                      <div className={`text-[11px] ${muted}`}>—</div>
                    ) : loading && !rows ? (
                      <div className={`text-[12px] ${muted}`}>…</div>
                    ) : (
                      <div className={`text-[11px] ${muted}`}>—</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className={`text-[10px] leading-relaxed mt-2 ${muted}`}>
            Quote only today · no swap is executed. <span className="font-bold">1-tap swap unlocks with KYB</span>.
          </p>
          {error && <p className={`text-[10px] font-bold text-center mt-2 ${dk ? "text-red-400" : "text-red-600"}`}>{error}</p>}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
