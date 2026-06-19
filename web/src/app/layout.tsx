import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://fud-arc-hackaton.vercel.app"),
  title: "FUD on Arc — P2P conviction markets",
  description:
    "An agent turns social trade calls into P2P USDC conviction markets on Arc, resolved by GenLayer, where the creator earns a cut.",
  openGraph: {
    title: "FUD on Arc — P2P conviction markets",
    description:
      "An agent turns social calls into P2P USDC markets on Arc — crypto + FX, resolved on-chain, the creator earns a cut.",
    url: "https://fud-arc-hackaton.vercel.app",
    siteName: "FUD on Arc",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "FUD on Arc — P2P conviction markets",
    description:
      "An agent turns social calls into P2P USDC markets on Arc — crypto + FX, resolved on-chain.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
