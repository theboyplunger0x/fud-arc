"use client";

import { useState } from "react";
import { useAccount, useChainId, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import marketAbi from "@/lib/fudArcMarketAbi.json";
import { arcTestnet, MARKET_ADDRESS } from "@/lib/arc";
import { wagmiConfig } from "@/lib/wagmi";
import { useCurrency } from "./CurrencyProvider";

function shortErr(msg: string): string {
  if (/user rejected|denied/i.test(msg)) return "Rejected";
  if (/already claimed/i.test(msg)) return "Already claimed";
  if (/no winnings/i.test(msg)) return "No claimable payout";
  return "Claim failed - try again";
}

interface ClaimPanelProps {
  marketId: number;
  dk: boolean;
  onDone?: () => void | Promise<void>;
}

export default function ClaimPanel({ marketId, dk, onDone }: ClaimPanelProps) {
  const { fmt } = useCurrency();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrongChain = isConnected && chainId !== arcTestnet.id;
  const { data: rawPayout, isLoading, refetch } = useReadContract({
    address: MARKET_ADDRESS,
    abi: marketAbi,
    functionName: "payoutOf",
    args: address ? [BigInt(marketId), address] : undefined,
    query: { enabled: !!address && !wrongChain },
  });

  const payout = (rawPayout as bigint | undefined) ?? BigInt(0);
  const muted = dk ? "text-white/35" : "text-gray-400";

  if (!isConnected) {
    return <p className={`text-[10px] font-bold text-center ${muted}`}>Connect your wallet to check payout</p>;
  }

  if (wrongChain) {
    return (
      <button
        onClick={() => switchChain({ chainId: arcTestnet.id })}
        disabled={switching}
        className={`w-full py-2 rounded-xl text-[12px] font-black transition disabled:opacity-50 ${dk ? "bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25" : "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"}`}
      >
        {switching ? "Switching..." : "Switch to Arc testnet"}
      </button>
    );
  }

  async function claim(): Promise<void> {
    if (claiming || payout <= BigInt(0)) return;
    setClaiming(true);
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: MARKET_ADDRESS,
        abi: marketAbi,
        functionName: "claim",
        args: [BigInt(marketId)],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash, timeout: 60_000 }).catch(() => {});
      await refetch();
      await onDone?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? shortErr(e.message) : "Claim failed");
    } finally {
      setClaiming(false);
    }
  }

  if (isLoading) {
    return <p className={`text-[10px] font-bold text-center ${muted}`}>Checking payout...</p>;
  }

  if (payout <= BigInt(0)) {
    return (
      <p className={`text-[10px] font-bold text-center ${muted}`}>
        No claimable payout for this wallet
        {error ? <span className={dk ? "text-red-400" : "text-red-600"}> · {error}</span> : null}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <button
        onClick={claim}
        disabled={claiming}
        className={`w-full py-2.5 rounded-xl text-[12px] font-black transition disabled:opacity-50 ${dk ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/30" : "bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200"}`}
      >
        {claiming ? "Claiming..." : `Claim ${fmt(payout)}`}
      </button>
      {error && <p className={`text-[10px] font-bold text-center ${dk ? "text-red-400" : "text-red-600"}`}>{error}</p>}
    </div>
  );
}
