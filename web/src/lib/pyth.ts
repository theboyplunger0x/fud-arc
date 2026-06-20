// Live price for a market's asset, read CLIENT-SIDE from Pyth's Hermes service.
// The Arc contract is asset-agnostic (it stores pools/close/outcome, not which
// asset a market is about), so the asset identity comes from market metadata
// (see marketMeta.ts) and the PRICE comes from Pyth here — the same feeds the
// resolver settles on-chain against.

const HERMES = "https://hermes.pyth.network";

export interface PythPrice {
  price: number;
  publishTime: number; // unix seconds
}

interface HermesParsed {
  parsed?: Array<{ price?: { price?: string; expo?: number; publish_time?: number } }>;
}

/** Latest price for a Pyth feed id (hex, with or without 0x). Null on failure. */
export async function fetchPythLatest(pythId: string): Promise<PythPrice | null> {
  const id = pythId.replace(/^0x/, "");
  try {
    const res = await fetch(`${HERMES}/v2/updates/price/latest?ids[]=${id}`);
    if (!res.ok) return null;
    const data = (await res.json()) as HermesParsed;
    const p = data?.parsed?.[0]?.price;
    if (!p || p.price === undefined || p.expo === undefined) return null;
    return {
      price: Number(p.price) * Math.pow(10, Number(p.expo)),
      publishTime: Number(p.publish_time ?? 0),
    };
  } catch {
    return null;
  }
}

/** Latest prices for many feeds at once, keyed by the input id (0x-stripped). */
export async function fetchPythLatestMany(
  pythIds: string[],
): Promise<Record<string, PythPrice>> {
  const ids = [...new Set(pythIds.map((i) => i.replace(/^0x/, "")))];
  if (ids.length === 0) return {};
  try {
    const qs = ids.map((i) => `ids[]=${i}`).join("&");
    const res = await fetch(`${HERMES}/v2/updates/price/latest?${qs}`);
    if (!res.ok) return {};
    const data = (await res.json()) as HermesParsed & {
      parsed?: Array<{ id?: string; price?: { price?: string; expo?: number; publish_time?: number } }>;
    };
    const out: Record<string, PythPrice> = {};
    for (const row of data?.parsed ?? []) {
      const p = row.price;
      if (!row.id || !p || p.price === undefined || p.expo === undefined) continue;
      out[row.id.replace(/^0x/, "")] = {
        price: Number(p.price) * Math.pow(10, Number(p.expo)),
        publishTime: Number(p.publish_time ?? 0),
      };
    }
    return out;
  } catch {
    return {};
  }
}
