import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { arcTestnet } from "./arc";

// Client-rendered app, so no SSR cookie hydration needed. Injected (MetaMask) to
// start; WalletConnect turns on when a public project id is configured.
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const connectors = walletConnectProjectId
  ? [injected(), walletConnect({ projectId: walletConnectProjectId, showQrModal: true })]
  : [injected()];

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors,
  transports: { [arcTestnet.id]: http() },
  ssr: false,
});
