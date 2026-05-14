// HAND-WRITTEN. Kubb-generated code imports `client` from here.
// Lives OUTSIDE packages/api-client/src/ because kubb's `clean: true` wipes that
// directory on every regen.
//
// The exported surface (default `client`, `RequestConfig`, `ResponseConfig`,
// `ResponseErrorConfig`) mirrors `@kubb/plugin-client/clients/fetch` so the
// generated `client/*.ts` and `hooks/*.ts` files type-check unmodified.

const baseUrl =
  (typeof window !== "undefined"
    ? (import.meta as unknown as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE
    : process.env.API_BASE) ?? "http://localhost:3000";

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export type RequestConfig<TData = unknown> = {
  baseURL?: string;
  url?: string;
  method?: "GET" | "PUT" | "PATCH" | "POST" | "DELETE" | "OPTIONS" | "HEAD";
  params?: unknown;
  data?: TData | FormData;
  responseType?: "arraybuffer" | "blob" | "document" | "json" | "text" | "stream";
  signal?: AbortSignal;
  headers?: Record<string, string>;
  credentials?: "omit" | "same-origin" | "include";
};

export type ResponseConfig<TData = unknown> = {
  data: TData;
  status: number;
  statusText: string;
  headers: Headers;
};

// kubb's fetch client treats ResponseErrorConfig as the raw error type — we
// surface our own augmented Error (see throw site below). Generated code uses
// it only as a generic parameter, so a structural alias is enough.
export type ResponseErrorConfig<TError = unknown> = TError;

export const client = async <TData, _TError = unknown, TVariables = unknown>(
  config: RequestConfig<TVariables>,
): Promise<ResponseConfig<TData>> => {
  const url = new URL(config.url ?? "", config.baseURL ?? baseUrl);
  if (config.params && typeof config.params === "object") {
    for (const [k, v] of Object.entries(config.params as Record<string, unknown>)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...config.headers,
  };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  const res = await fetch(url, {
    method: config.method ?? "GET",
    headers,
    body: config.data ? JSON.stringify(config.data) : undefined,
    signal: config.signal,
    credentials: config.credentials,
  });
  const data = res.headers.get("content-type")?.includes("application/json")
    ? ((await res.json()) as TData)
    : ((await res.text()) as TData);
  if (!res.ok) {
    const error = new Error(`HTTP ${res.status}`) as Error & { status: number; data: unknown };
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return { data, status: res.status, statusText: res.statusText, headers: res.headers };
};

export default client;
