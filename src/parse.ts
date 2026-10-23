/**
 * Pulls parameters out of the user's words. Only bounded numbers ever reach a
 * URL, so free text cannot inject anything into the request.
 */

export const MIN_GAS_LIMIT = 21_000;
export const MAX_GAS_LIMIT = 30_000_000;
export const MAX_HOURS = 168;

const PRESETS: [RegExp, number][] = [
  [/\bdeploy/i, 1_500_000],
  [/\bswap/i, 180_000],
  [/\b(mint|nft)/i, 85_000],
  [/\b(erc-?20|token transfer|(send|transfer)\b.*\b(usdc|usdt|dai|tokens?))\b/i, 65_000],
];

/** Explicit gas limit ("180000 gas"), else a preset for the named operation, else null (API default). */
export function parseGasLimit(text: string): number | null {
  for (const m of text.matchAll(/\b(\d[\d,_]{4,11})\b/g)) {
    const n = Number(m[1].replace(/[,_]/g, ""));
    if (Number.isInteger(n) && n >= MIN_GAS_LIMIT && n <= MAX_GAS_LIMIT) return n;
  }
  for (const [pattern, gas] of PRESETS) if (pattern.test(text)) return gas;
  return null;
}

/** "last 6 hours", "48h", "today", "this week" -> hours, clamped to 1..168; null for the API default. */
export function parseHours(text: string): number | null {
  const m = text.match(/\b(\d{1,3})\s*(h|hrs?|hours?)\b/i);
  if (m) return Math.min(MAX_HOURS, Math.max(1, Number(m[1])));
  const d = text.match(/\b(\d{1,2})\s*days?\b/i);
  if (d) return Math.min(MAX_HOURS, Math.max(1, Number(d[1]) * 24));
  if (/\b(week|7 ?days)\b/i.test(text)) return 168;
  if (/\b(today|24 ?h|day)\b/i.test(text)) return 24;
  return null;
}
