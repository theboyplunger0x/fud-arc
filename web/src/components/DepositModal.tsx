"use client";

import { createPortal } from "react-dom";
import { motion } from "framer-motion";

const FAUCET = "https://faucet.circle.com";

// Stablecoins on Arc (StableFX/BUFI coverage). Minimal: ticker + name + flag.
const STABLECOINS = [
  { ticker: "USDC", name: "US Dollar", flag: "🇺🇸" },
  { ticker: "EURC", name: "Euro", flag: "🇪🇺" },
  { ticker: "MXNB", name: "Mexican Peso", flag: "🇲🇽" },
  { ticker: "QCAD", name: "Canadian Dollar", flag: "🇨🇦" },
  { ticker: "AUDF", name: "Australian Dollar", flag: "🇦🇺" },
];

export default function DepositModal({ dk, onClose }: { dk: boolean; onClose: () => void }) {
  const bg = dk ? "bg-[#111] border-white/10" : "bg-white border-gray-200";
  const muted = dk ? "text-white/40" : "text-gray-400";
  const strong = dk ? "text-white" : "text-gray-900";

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
            <h3 className={`text-[16px] font-black ${strong}`}>Add funds</h3>
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
            At faucet.circle.com: pick <span className="font-bold">Arc Testnet</span> + <span className="font-bold">USDC</span>, paste your wallet address.
          </p>

          {/* Supported assets */}
          <p className={`text-[10px] font-black uppercase tracking-widest ${muted}`}>Supported stablecoins</p>
          <p className={`text-[11px] mb-2 ${muted}`}>
            Fund with any → trade in USDC <span className="opacity-60">· any-stable swap coming via StableFX</span>
          </p>
          <div className="space-y-1.5">
            {STABLECOINS.map((s) => (
              <div
                key={s.ticker}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 ${dk ? "bg-white/[0.03]" : "bg-gray-50"}`}
              >
                <span className="text-[16px] leading-none">{s.flag}</span>
                <span className={`text-[12px] font-black ${strong}`}>{s.ticker}</span>
                <span className={`text-[11px] font-bold ${muted}`}>{s.name}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
