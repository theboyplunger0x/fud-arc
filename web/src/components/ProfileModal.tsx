"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { useDisconnect, useReadContract } from "wagmi";
import { USDC_ADDRESS, usd, type Market } from "@/lib/arc";
import { useProfile, PROFILE_COLORS } from "@/hooks/useProfile";

const BAL_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function ProfileModal({ address, dk, markets, onClose }: { address: string; dk: boolean; markets: Market[]; onClose: () => void }) {
  const { profile, save } = useProfile(address);
  const { disconnect } = useDisconnect();
  const { data: bal } = useReadContract({
    address: USDC_ADDRESS,
    abi: BAL_ABI,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  });
  const [editing, setEditing] = useState(!profile?.handle);
  const [handle, setHandle] = useState(profile?.handle ?? "");
  const [color, setColor] = useState(profile?.color ?? PROFILE_COLORS[0]);

  // On-chain stats for this address (markets they opened).
  const mine = markets.filter((m) => m.opener.toLowerCase() === address.toLowerCase());
  const marketsOpened = mine.length;
  const createdVol = mine.reduce((s, m) => s + m.longPool + m.shortPool, BigInt(0));

  const avatarColor = profile?.color ?? color;
  const initial = ((profile?.handle ?? handle).trim()[0] ?? address[2] ?? "?").toUpperCase();
  const name = profile?.handle ? `@${profile.handle}` : shortAddr(address);

  const bg = dk ? "bg-[#111] border-white/10" : "bg-white border-gray-200";
  const muted = dk ? "text-white/40" : "text-gray-400";
  const strong = dk ? "text-white" : "text-gray-900";
  const lbl = `text-[10px] font-black uppercase tracking-widest ${muted}`;
  const statCard = `rounded-2xl px-3 py-2.5 text-center ${dk ? "bg-white/5" : "bg-gray-50"}`;

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
          {/* Header — avatar + identity */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-14 h-14 rounded-full flex items-center justify-center text-[22px] font-black shrink-0" style={{ background: editing ? color : avatarColor, color: "#0A0A0A" }}>
                {initial}
              </span>
              <div className="min-w-0">
                <p className={`text-[16px] font-black truncate ${strong}`}>{name}</p>
                {profile?.handle && <p className={`text-[11px] font-mono ${muted}`}>{shortAddr(address)}</p>}
              </div>
            </div>
            <button onClick={onClose} className={`text-[18px] font-bold ${muted} hover:opacity-60`}>✕</button>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className={statCard}>
              <p className={`${lbl} mb-0.5`}>Balance</p>
              <p className={`text-[16px] font-black ${strong}`}>${bal != null ? usd(bal as bigint) : "—"}</p>
            </div>
            <div className={statCard}>
              <p className={`${lbl} mb-0.5`}>Markets</p>
              <p className={`text-[16px] font-black ${strong}`}>{marketsOpened}</p>
            </div>
            <div className={statCard}>
              <p className={`${lbl} mb-0.5`}>Vol</p>
              <p className={`text-[16px] font-black ${strong}`}>${usd(createdVol)}</p>
            </div>
          </div>

          {editing ? (
            <>
              {/* handle */}
              <label className={lbl}>Handle</label>
              <div className="relative mt-1">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-bold ${dk ? "text-white/30" : "text-gray-400"}`}>@</span>
                <input
                  autoFocus
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="username"
                  maxLength={20}
                  className={`w-full text-[13px] font-bold pl-7 pr-3 py-2.5 rounded-xl outline-none ${dk ? "bg-white/[0.05] text-white placeholder:text-white/30" : "bg-gray-100 text-gray-900 placeholder:text-gray-400"}`}
                />
              </div>
              {/* avatar color */}
              <label className={`${lbl} block mt-3`}>Avatar color</label>
              <div className="flex gap-2 mt-1.5">
                {PROFILE_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    aria-label={`color ${c}`}
                    className={`w-8 h-8 rounded-full transition ${color === c ? `ring-2 ring-offset-2 ${dk ? "ring-white ring-offset-[#111]" : "ring-gray-900 ring-offset-white"}` : ""}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
              <button
                onClick={() => { save({ handle, color }); setEditing(false); }}
                className="w-full mt-5 py-3 rounded-xl text-[13px] font-black bg-emerald-400 text-[#0A0A0A] hover:bg-emerald-300 transition"
              >
                Save profile
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className={`w-full py-2.5 rounded-xl text-[12px] font-black border transition ${dk ? "border-white/10 text-white/60 hover:text-white/90 hover:border-white/20" : "border-gray-200 text-gray-600 hover:text-gray-900"}`}
            >
              Edit profile
            </button>
          )}

          <button
            onClick={() => { disconnect(); onClose(); }}
            className={`w-full mt-2 py-2.5 rounded-xl text-[12px] font-bold transition ${dk ? "text-white/50 hover:bg-white/[0.06]" : "text-gray-500 hover:bg-gray-100"}`}
          >
            Disconnect
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
