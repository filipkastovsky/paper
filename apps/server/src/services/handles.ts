const HANDLE_RX = /^[a-z][a-z0-9_]{2,19}$/;

const RESERVED = new Set([
  "admin",
  "administrator",
  "root",
  "support",
  "help",
  "api",
  "www",
  "paper",
  "papercrypto",
  "official",
  "system",
  "moderator",
  "mod",
  "owner",
  "ceo",
  "team",
  "staff",
  "abuse",
  "security",
  "billing",
  "test",
]);

export type HandleValidationError = { kind: "invalid_format" } | { kind: "reserved" };

export function validateHandleFormat(handle: string): HandleValidationError | null {
  if (!HANDLE_RX.test(handle)) return { kind: "invalid_format" };
  if (RESERVED.has(handle)) return { kind: "reserved" };
  return null;
}

export function normalizeHandle(input: string): string {
  return input.trim().toLowerCase();
}
