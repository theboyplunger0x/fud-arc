import { ImageResponse } from "next/og";

export const alt = "FUD on Arc — P2P conviction markets";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Dynamic social preview card in the FUD look (near-black canvas, emerald accent).
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#0A0A0A",
          color: "#ffffff",
          padding: "80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 96, fontWeight: 900, letterSpacing: "-4px" }}>
          FUD<span style={{ color: "#34D399" }}>.</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", fontSize: 56, fontWeight: 800, marginTop: 16, lineHeight: 1.1 }}>
          Social calls become P2P markets on Arc.
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "rgba(255,255,255,0.55)", marginTop: 28, maxWidth: 980 }}>
          An agent turns a Telegram call into a USDC conviction market — resolved on-chain, the creator earns a cut.
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "rgba(255,255,255,0.35)", marginTop: 44 }}>
          crypto + FX · resolved by GenLayer / Pyth · stablecoin-native
        </div>
      </div>
    ),
    { ...size },
  );
}
