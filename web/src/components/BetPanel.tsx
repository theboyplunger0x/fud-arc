"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAccount, useChainId, useSwitchChain, useReadContract, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { parseUnits } from "viem";
import marketAbi from "@/lib/fudArcMarketAbi.json";
import { MARKET_ADDRESS, USDC_ADDRESS, arcTestnet } from "@/lib/arc";
import { wagmiConfig } from "@/lib/wagmi";

const ERC20_ABI = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

const FAUCET = "https://faucet.circle.com";
const PRESETS = [1, 5, 10, 25];

function shortErr(msg: string): string {
  if (/user rejected|denied/i.test(msg)) return "Rejected";
  if (/insufficient/i.test(msg)) return "Insufficient funds";
  return "Tx failed — try again";
}

interface BetPanelProps {
  marketId: number;
  dk: boolean;
  longMult?: number;
  shortMult?: number;
  onDone?: () => void | Promise<void>;
}

export default function BetPanel({ marketId, dk, longMult, shortMult, onDone }: BetPanelProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [activeSide, setActiveSide] = useState<0 | 1 | null>(null); // null = picker closed
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"idle" | "approving" | "betting">("idle");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false); // synchronous re-entrancy latch (double-click / Enter+click)

  const wrongChain = isConnected && chainId !== arcTestnet.id;

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, MARKET_ADDRESS] : undefined,
    query: { enabled: !!address && !wrongChain },
  });
  const { writeContractAsync } = useWriteContract();

  const busy = step !== "idle";
  const muted = dk ? "text-white/35" : "text-gray-400";

  if (!isConnected) {
    return <p className={`text-[10px] font-bold text-center ${muted}`}>Connect your wallet ↑ to back a side</p>;
  }

  if (wrongChain) {
    return (
      <button
        onClick={() => switchChain({ chainId: arcTestnet.id })}
        disabled={switching}
        className={`w-full py-2 rounded-xl text-[12px] font-black transition disabled:opacity-50 ${dk ? "bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25" : "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"}`}
      >
        {switching ? "Switching…" : "Switch to Arc testnet"}
      </button>
    );
  }

  // Poll the on-chain allowance until it covers `units`. More robust than
  // waitForTransactionReceipt, which can hang on Arc's RPC even after the approve
  // is mined (left the UI stuck on "Approving…" forever).
  async function awaitAllowance(units: bigint): Promise<boolean> {
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const res = await refetchAllowance();
      if (((res.data as bigint | undefined) ?? BigInt(0)) >= units) return true;
    }
    return false;
  }

  async function placeBet(amountVal: number) {
    const side = activeSide;
    if (side === null || inFlight.current) return;
    setError(null);
    if (!Number.isFinite(amountVal) || amountVal <= 0) {
      setError("Enter an amount");
      return;
    }
    inFlight.current = true;
    const units = parseUnits(String(amountVal), 6);
    try {
      const allow = (allowance as bigint | undefined) ?? BigInt(0);
      if (allow < units) {
        setStep("approving");
        // Approve a bounded, generous amount so repeat bets don't re-approve.
        await writeContractAsync({
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [MARKET_ADDRESS, parseUnits("1000000", 6)],
        });
        const confirmed = await awaitAllowance(units);
        if (!confirmed) {
          setError("Approval still pending — check your wallet, then try again.");
          return;
        }
      }
      setStep("betting");
      const bh = await writeContractAsync({
        address: MARKET_ADDRESS,
        abi: marketAbi,
        functionName: "bet",
        args: [BigInt(marketId), side, units],
      });
      // Best-effort wait — don't let a slow receipt hang the UI.
      await waitForTransactionReceipt(wagmiConfig, { hash: bh, timeout: 60_000 }).catch(() => {});
      setAmount("");
      setActiveSide(null);
      await onDone?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? shortErr(e.message) : "Failed");
    } finally {
      inFlight.current = false;
      setStep("idle");
    }
  }

  const isLong = activeSide === 0;
  const sideColor = isLong ? "text-emerald-400" : "text-red-400";
  const mult = isLong ? longMult : shortMult;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {activeSide === null ? (
        // ── collapsed: pick a side ──
        <motion.div key="sides" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex gap-2">
          <button
            onClick={() => { setActiveSide(1); setError(null); }}
            className={`flex-1 py-3 rounded-xl text-[13px] font-black border transition ${dk ? "bg-red-500/15 text-red-400 border-red-500/25 hover:bg-red-500/25" : "bg-red-50 text-red-600 border-red-200 hover:bg-red-100"}`}
          >
            ▼ Short
          </button>
          <button
            onClick={() => { setActiveSide(0); setError(null); }}
            className={`flex-1 py-3 rounded-xl text-[13px] font-black border transition ${dk ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/25" : "bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100"}`}
          >
            Long ▲
          </button>
        </motion.div>
      ) : (
        // ── expanded: amount picker ──
        <motion.div key="picker" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-2">
          <div className="flex items-center justify-between">
            <span className={`text-[12px] font-black ${sideColor}`}>
              {isLong ? "Long ▲" : "▼ Short"}
              {mult ? <span className={`ml-1 ${muted}`}>· {mult.toFixed(2)}x</span> : null}
            </span>
            <button
              onClick={() => { setActiveSide(null); setAmount(""); setError(null); }}
              disabled={busy}
              className={`text-[12px] font-bold disabled:opacity-30 ${muted} hover:opacity-70`}
            >
              ✕
            </button>
          </div>

          {busy ? (
            <div className={`py-2.5 rounded-xl text-[12px] font-black text-center ${dk ? "bg-white/[0.04] text-white/70" : "bg-gray-100 text-gray-600"}`}>
              {step === "approving" ? "Approving USDC…" : "Placing bet…"}
            </div>
          ) : (
            <>
              {/* presets — bet instantly */}
              <div className="grid grid-cols-4 gap-1.5">
                {PRESETS.map((a) => (
                  <button
                    key={a}
                    onClick={() => placeBet(a)}
                    className={`py-2 rounded-lg text-[11px] font-black transition ${dk ? "bg-white/[0.05] text-white/80 hover:bg-white/[0.12]" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                  >
                    ${a}
                  </button>
                ))}
              </div>
              {/* custom + Add */}
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-bold ${muted}`}>$</span>
                  <input
                    autoFocus
                    type="number"
                    inputMode="decimal"
                    placeholder="custom"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && placeBet(Number(amount))}
                    className={`w-full text-[12px] font-bold pl-6 pr-3 py-2 rounded-xl outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${dk ? "bg-white/[0.04] text-white placeholder:text-white/30" : "bg-gray-100 text-gray-900 placeholder:text-gray-400"}`}
                  />
                </div>
                <button
                  onClick={() => placeBet(Number(amount))}
                  disabled={!amount || Number(amount) <= 0}
                  className={`px-4 py-2 rounded-xl text-[12px] font-black transition disabled:opacity-40 ${isLong
                    ? dk ? "bg-emerald-500/25 text-emerald-300 hover:bg-emerald-500/35" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                    : dk ? "bg-red-500/25 text-red-300 hover:bg-red-500/35" : "bg-red-100 text-red-700 hover:bg-red-200"}`}
                >
                  Add
                </button>
              </div>
              {error && (
                <p className={`text-[10px] font-bold text-center ${dk ? "text-red-400" : "text-red-600"}`}>
                  {error}
                  {error === "Insufficient funds" && (
                    <>
                      {" · "}
                      <a href={FAUCET} target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">
                        Get test USDC
                      </a>
                    </>
                  )}
                </p>
              )}
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
