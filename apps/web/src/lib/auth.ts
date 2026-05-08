import { setAccessToken } from "@paper/api-client";

const STORAGE_DEVICE = "paper.device_uuid";
const STORAGE_REFRESH = "paper.refresh_token";
const STORAGE_USER = "paper.user";

interface StoredUser {
  id: string;
  handle: string | null;
}

interface AuthApiResponse {
  access_token: string;
  refresh_token: string;
  user: StoredUser;
}

interface RefreshResponse {
  access_token: string;
  refresh_token: string;
}

function ensureDeviceUuid(): string {
  let uuid = localStorage.getItem(STORAGE_DEVICE);
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem(STORAGE_DEVICE, uuid);
  }
  return uuid;
}

async function postJson<TBody, TResp>(path: string, body: TBody): Promise<TResp> {
  const base = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`auth ${path} failed: ${res.status}`);
  return res.json() as Promise<TResp>;
}

export async function bootstrapAuth(): Promise<StoredUser> {
  const refresh = localStorage.getItem(STORAGE_REFRESH);

  if (refresh) {
    try {
      const data = await postJson<{ refresh_token: string }, RefreshResponse>("/v1/auth/refresh", {
        refresh_token: refresh,
      });
      setAccessToken(data.access_token);
      localStorage.setItem(STORAGE_REFRESH, data.refresh_token);
      return readUser();
    } catch {
      localStorage.removeItem(STORAGE_REFRESH);
      localStorage.removeItem(STORAGE_USER);
    }
  }

  const data = await postJson<{ device_uuid: string }, AuthApiResponse>("/v1/auth/device", {
    device_uuid: ensureDeviceUuid(),
  });
  setAccessToken(data.access_token);
  localStorage.setItem(STORAGE_REFRESH, data.refresh_token);
  localStorage.setItem(STORAGE_USER, JSON.stringify(data.user));
  return data.user;
}

function readUser(): StoredUser {
  const raw = localStorage.getItem(STORAGE_USER);
  if (!raw) throw new Error("user missing after auth");
  return JSON.parse(raw) as StoredUser;
}

export function getStoredUser(): StoredUser | null {
  const raw = localStorage.getItem(STORAGE_USER);
  return raw ? (JSON.parse(raw) as StoredUser) : null;
}
