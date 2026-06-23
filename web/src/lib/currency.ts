import { usd } from "@/lib/arc";

// Display currencies for the whole app. Values are always settled in USDC on-chain;
// non-USDC currencies are an INDICATIVE display conversion via live StableFX rates.

export interface CurrencyDef {
  code: string; // quote symbol / on-chain ticker, e.g. "EURC"
  label: string; // compact display, e.g. "EUR"
  symbol: string; // "€"
  flag: string; // "🇪🇺"
  name: string; // "Euro"
}

export type Rates = Record<string, number>; // 1 [code] = N USDC (StableFX effectiveRate)

export const USDC: CurrencyDef = { code: "USDC", label: "USD", symbol: "$", flag: "🇺🇸", name: "US Dollar" };

// Stablecoins verified to route to USDC on Arc testnet (live StableFX quotes).
// Kept in sync with BOARD_CURRENCIES in /api/fx-board.
export const FUNDING_CURRENCIES: CurrencyDef[] = [
  { code: "EURC", label: "EUR", symbol: "€", flag: "🇪🇺", name: "Euro" },
  { code: "MXNB", label: "MXN", symbol: "MX$", flag: "🇲🇽", name: "Mexican Peso" },
  { code: "QCAD", label: "CAD", symbol: "C$", flag: "🇨🇦", name: "Canadian Dollar" },
  { code: "AUDF", label: "AUD", symbol: "A$", flag: "🇦🇺", name: "Australian Dollar" },
];

export const DISPLAY_CURRENCIES: CurrencyDef[] = [USDC, ...FUNDING_CURRENCIES];

export function currencyByCode(code: string): CurrencyDef {
  return DISPLAY_CURRENCIES.find((c) => c.code === code) ?? USDC;
}

// Format a 6-decimal USDC bigint in the selected currency.
// USDC → "$1,234.56" (identical to usd()). Others → "≈ €1,120" (indicative, live FX).
export function formatUnits(units: bigint, currency: CurrencyDef, rates: Rates | null): string {
  if (currency.code === "USDC") return `$${usd(units)}`;
  const rate = rates?.[currency.code];
  if (!rate || rate <= 0) return `${currency.symbol}—`; // rate unavailable → honest placeholder
  const dollars = Number(units) / 1e6;
  const converted = dollars / rate;
  const grouped = converted.toLocaleString("en-US", {
    maximumFractionDigits: Math.abs(converted) >= 1000 ? 0 : 2,
  });
  return `≈ ${currency.symbol}${grouped}`;
}

// Inverse rate for a "1 USDC = X local" ticker line.
export function perUsdc(code: string, rates: Rates): number | null {
  const r = rates[code];
  return r ? 1 / r : null;
}
