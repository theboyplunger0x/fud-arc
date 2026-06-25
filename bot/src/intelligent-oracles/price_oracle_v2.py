# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json


ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"
TOL_MAJOR = 0.015  # 1.5% minimum tolerance for live major prices.


def _within(a: float, b: float, tol: float) -> bool:
    if a <= 0 or b <= 0:
        return False
    return abs(a - b) / ((a + b) / 2.0) <= tol


def _http_get_json(url: str) -> dict:
    response = gl.nondet.web.get(url)
    status = getattr(response, "status", 200)
    if 400 <= status < 500:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} {url} returned {status}")
    if status >= 500:
        raise gl.vm.UserError(f"{ERROR_TRANSIENT} {url} returned {status}")
    try:
        return json.loads(response.body.decode("utf-8"))
    except Exception as e:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} {url} non-JSON body: {e}")


def _compute_major(symbol: str, pyth_feed_id: str, coinbase_pair: str, coingecko_id: str) -> dict:
    pyth = 0.0
    coinbase = 0.0
    coingecko = 0.0
    sources = ""

    try:
        if pyth_feed_id:
            feed = pyth_feed_id.replace("0x", "")
            data = _http_get_json(
                f"https://hermes.pyth.network/v2/updates/price/latest?ids[]={feed}&parsed=true"
            )
            parsed = data.get("parsed") or []
            if len(parsed) > 0:
                price_obj = parsed[0]["price"]
                raw = float(price_obj["price"])
                expo = int(price_obj["expo"])
                scale = 1.0
                e = expo
                if e < 0:
                    e = -e
                while e > 0:
                    scale = scale * 10.0
                    e = e - 1
                if expo >= 0:
                    pyth = raw * scale
                else:
                    pyth = raw / scale
                if pyth > 0:
                    sources = "pyth"
    except gl.vm.UserError:
        pass

    try:
        if coinbase_pair:
            data = _http_get_json(f"https://api.coinbase.com/v2/prices/{coinbase_pair}/spot")
            coinbase = float(data["data"]["amount"])
            if coinbase > 0:
                sources = sources + ",coinbase" if sources else "coinbase"
    except gl.vm.UserError:
        pass

    try:
        if coingecko_id:
            data = _http_get_json(
                f"https://api.coingecko.com/api/v3/simple/price?ids={coingecko_id}&vs_currencies=usd"
            )
            coingecko = float(data[coingecko_id]["usd"])
            if coingecko > 0:
                sources = sources + ",coingecko" if sources else "coingecko"
    except gl.vm.UserError:
        pass

    if pyth > 0 and coinbase > 0 and coingecko > 0:
        vals = [pyth, coinbase, coingecko]
        vals.sort()
        price = vals[1]
        confidence = "high"
    elif coinbase > 0 and coingecko > 0:
        price = (coinbase + coingecko) / 2.0
        confidence = "medium"
    elif pyth > 0 and coinbase > 0:
        price = (pyth + coinbase) / 2.0
        confidence = "medium"
    elif pyth > 0 and coingecko > 0:
        price = (pyth + coingecko) / 2.0
        confidence = "medium"
    elif coinbase > 0:
        price = coinbase
        confidence = "low"
    elif coingecko > 0:
        price = coingecko
        confidence = "low"
    elif pyth > 0:
        price = pyth
        confidence = "low"
    else:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} no valid major prices for {symbol}")

    return {"price": str(price), "sources": sources, "confidence": confidence}


class PriceOracle(gl.Contract):
    symbol: str
    pyth_feed_id: str
    coinbase_pair: str
    coingecko_id: str
    price_usd: str
    confidence: str
    sources_csv: str
    resolved: bool

    def __init__(self, symbol: str, pyth_feed_id: str, coinbase_pair: str, coingecko_id: str):
        self.symbol = symbol
        self.pyth_feed_id = pyth_feed_id
        self.coinbase_pair = coinbase_pair
        self.coingecko_id = coingecko_id
        self.price_usd = "0"
        self.confidence = "low"
        self.sources_csv = ""
        self.resolved = False

    @gl.public.write
    def resolve(self):
        def leader_fn() -> dict:
            return _compute_major(self.symbol, self.pyth_feed_id, self.coinbase_pair, self.coingecko_id)

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return False
            leader_price = float(leaders_res.calldata["price"])
            mine = _compute_major(self.symbol, self.pyth_feed_id, self.coinbase_pair, self.coingecko_id)
            return _within(leader_price, float(mine["price"]), TOL_MAJOR)

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        self.price_usd = result["price"]
        self.sources_csv = result["sources"]
        self.confidence = result["confidence"]
        self.resolved = True

    @gl.public.view
    def get_price(self) -> dict:
        return {
            "symbol": self.symbol,
            "asset_type": "major",
            "price": self.price_usd,
            "confidence": self.confidence,
            "sources": self.sources_csv,
            "resolved": self.resolved,
        }
