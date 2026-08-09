export const API_URL = import.meta.env.VITE_API_URL;

const TOKEN_KEY = "campfire_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError((body as { error?: string } | null)?.error || res.statusText, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function apiPostText<T>(path: string, text: string): Promise<T> {
  return request<T>(path, { method: "POST", headers: { "Content-Type": "text/plain" }, body: text });
}

/** Fire-and-forget progress save that must survive the tab actually closing (pagehide) —
 * `navigator.sendBeacon` can't attach an Authorization header, so `fetch` with `keepalive: true` is
 * used instead (well-supported in evergreen browsers, and unlike sendBeacon it accepts headers). */
export function apiPostKeepalive(path: string, body: unknown): void {
  const token = getToken();
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  fetch(`${API_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body), keepalive: true }).catch(
    () => {},
  );
}

/** Downloads an admin-only file (converter output, subtitle .vtt) via an authenticated fetch, then
 * triggers a normal browser save via a throwaway anchor — a plain `<a href>` can't send an
 * Authorization header, and these one-shot admin downloads don't fit the video/thumbnail scoped
 * media-token pattern (see lib/mediaToken.ts), so a full blob fetch is simplest here. */
export async function downloadAuthedFile(path: string, filename: string): Promise<void> {
  const url = await fetchAuthedBlobUrl(path);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Fetches an admin-only or user-scoped image (thumbnail) with the normal Bearer header and hands
 * back an object URL — simpler than minting a scoped media token for something that's never
 * Range-requested or long-lived the way video playback is (see lib/mediaToken.ts). Caller owns the
 * returned URL and must revoke it. */
export async function fetchAuthedBlobUrl(path: string): Promise<string> {
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) throw new ApiError("Failed to load", res.status);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
