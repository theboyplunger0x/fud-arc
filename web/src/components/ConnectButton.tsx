"use client";

import { useState } from "react";
import { useAccount, useConnect, useReadContract } from "wagmi";
import { USDC_ADDRESS, usd, type Market } from "@/lib/arc";
import { useProfile } from "@/hooks/useProfile";
import ProfileModal from "./ProfileModal";

const BAL_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function ConnectButton({ dk, markets }: { dk: boolean; markets: Market[] }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { profile } = useProfile(address);
  const { data: bal } = useReadContract({
    address: USDC_ADDRESS,
    abi: BAL_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const [open, setOpen] = useState(false);

  if (isConnected && address) {
    const initial = (profile?.handle?.[0] ?? address[2]).toUpperCase();
    const color = profile?.color ?? "#34d399";
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          title="Profile"
          className={`flex items-center gap-1.5 rounded-xl p-1 pr-2.5 transition ${dk ? "bg-white/[0.05] border border-white/10 hover:bg-white/[0.09]" : "bg-gray-100 border border-gray-200 hover:bg-gray-200"}`}
        >
          {bal != null && (
            <span className={`text-[12px] font-black tabular-nums pl-2 ${dk ? "text-emerald-300" : "text-emerald-700"}`}>
              ${usd(bal as bigint)}
            </span>
          )}
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black" style={{ background: color, color: "#0A0A0A" }}>
            {initial}
          </span>
          <span className={`text-[12px] font-bold ${dk ? "text-white/80" : "text-gray-700"}`}>
            {profile?.handle ? `@${profile.handle}` : shortAddr(address)}
          </span>
        </button>
        {open && <ProfileModal address={address} dk={dk} markets={markets} onClose={() => setOpen(false)} />}
      </>
    );
  }

  return (
    <button
      onClick={() => connectors[0] && connect({ connector: connectors[0] })}
      disabled={isPending || !connectors[0]}
      className={`px-5 py-2.5 rounded-xl text-[14px] font-black transition disabled:opacity-50 ${dk ? "bg-emerald-400 text-[#0A0A0A] hover:bg-emerald-300" : "bg-emerald-500 text-white hover:bg-emerald-600"}`}
    >
      {isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
