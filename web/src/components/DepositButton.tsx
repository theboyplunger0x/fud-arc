"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import DepositModal from "./DepositModal";

export default function DepositButton({ dk }: { dk: boolean }) {
  const { isConnected } = useAccount();
  const [open, setOpen] = useState(false);

  if (!isConnected) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`px-3 py-2 rounded-xl text-[12px] font-black transition ${dk ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25" : "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"}`}
      >
        + Deposit
      </button>
      {open && <DepositModal dk={dk} onClose={() => setOpen(false)} />}
    </>
  );
}
