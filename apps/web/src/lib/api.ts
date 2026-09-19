import { useCallback } from "react";

/**
 * Session handling: JWT (human, from /v1/auth/*) or demo API key.
 * JWT wins when present; demo mode is the frictionless fallback.
 */
const TOKEN_KEY = "studio.token";
const API_KEY_KEY = "studio.apiKey";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  listeners.forEach((l) => l());
}

export function getApiKey(): string {
  return localStorage.getItem(API_KEY_KEY) ?? "sk_demo_alpha";
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_KEY, key);
  listeners.forEach((l) => l());
}

export function authMode(): "jwt" | "demo" {
  return getToken() ? "jwt" : "demo";
}

const listeners = new Set<() => void>();

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  else headers["x-api-key"] = getApiKey();

  let body = init?.body;
  if (init?.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const response = await fetch(path, { ...init, body, headers: { ...headers, ...(init?.headers as Record<string, string>) } });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: { code: string; message: string } };
  if (!response.ok) {
    if (response.status === 401 && token) setToken(null); // expired session → back to login
    throw new ApiError(response.status, payload.error?.code ?? "request_failed", payload.error?.message ?? response.statusText);
  }
  return payload;
}

export function useApiRefetch(): () => void {
  return useCallback(() => window.dispatchEvent(new Event("studio:refetch")), []);
}
