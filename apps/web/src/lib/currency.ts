/**
 * Parse a Postgres numeric(20,8) string into a JS number for display.
 * Loses precision past 2^53; trade execution and persistence stay string-based.
 */
export function parseCash(input: string): number {
  const n = Number.parseFloat(input);
  return Number.isFinite(n) ? n : 0;
}
