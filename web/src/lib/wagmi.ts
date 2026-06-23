import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { arcTestnet } from "./arc";

// Client-rendered app, so no SSR cookie hydration needed. Injected (MetaMask) to
// start — WalletConnect / Privy connectors get added once their ids are set.
export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [injected()],
  transports: { [arcTestnet.id]: http() },
  ssr: false,
});
