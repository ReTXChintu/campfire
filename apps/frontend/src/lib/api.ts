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
  /** The form field the server blamed, when it named one (`{ error, field }`) — used by the
   * request form and the admin requests panel to put the server's own message next to the input
   * that caused it rather than in a generic banner. */
  field: string | null;
  /** The rest of the error body, for the few endpoints that add detail (e.g. `maxBytes` on a
   * too-large reference image). */
  body: Record<string, unknown> | null;
  constructor(message: string, status: number, body?: Record<string, unknown> | null) {
    super(message);
    this.status = status;
    this.body = body ?? null;
    this.field = typeof body?.field === "string" ? body.field : null;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    throw new ApiError(
      (typeof body?.error === "string" ? body.error : null) || res.statusText,
      res.status,
      body,
    );
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

export function apiPatch<T>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, {
    method: "DELETE",
  });
}

export function apiPostText<T>(path: string, text: string): Promise<T> {
  return request<T>(path, { method: "POST", headers: { "Content-Type": "text/plain" }, body: text });
}

/** Raw-bytes POST: the body *is* the file and the real image type goes in Content-Type. The
 * reference-image upload (and the admin stage route) read the request stream directly rather than
 * going through a multipart parser, so there's no FormData involved. */
export function apiPostBinary<T>(path: string, file: Blob): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
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
