"use client";

import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import CurrencyProvider from "./CurrencyProvider";

// Wallet + data-fetching + display-currency context for the whole app (client-only).
export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <CurrencyProvider>{children}</CurrencyProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
