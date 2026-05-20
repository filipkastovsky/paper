/**
 * Currency + percent formatters used by Marshmallow numeral primitives.
 * One Intl instance per format — Intl.NumberFormat is expensive to construct.
 */

const usd = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdInt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const pct = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const cryptoQty = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 8,
});

export function formatUsd(value: number) {
  return usd.format(value);
}

export function formatUsdInt(value: number) {
  return usdInt.format(value);
}

/** `+4.82%` / `-1.60%`. Sign always shown so up/down chips read at a glance. */
export function formatPct(value: number) {
  const sign = value > 0 ? "+" : "";
  return sign + pct.format(value);
}

export function formatCryptoQty(value: number, symbol?: string) {
  const num = cryptoQty.format(value);
  return symbol ? `${num} ${symbol}` : num;
}

/** Split a USD amount for hero numerals: `{ whole: "10,482", decimal: "14" }` */
export function splitUsd(value: number) {
  const [whole, decimal = "00"] = formatUsd(value).split(".");
  return { whole, decimal };
}
