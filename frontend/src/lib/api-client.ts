/**
 * Backend API client for the Rust backend (Axum).
 *
 * In this Vite SPA, the Rust server serves BOTH the static frontend bundle
 * AND the REST API on the same origin (default :8080). API paths are
 * relative (`/api/...`) and `fetch` resolves them against the current
 * origin — no proxy, no port redirect, no env-gated feature flag.
 *
 * Usage:
 *   import { apiFetch } from '@/lib/api-client'
 *   const res = await apiFetch('/api/brands')
 *   const res = await apiFetch('/api/bookings', { method: 'POST', body: JSON.stringify(payload) })
 *
 * The helper auto-includes credentials (cookies) so JWT httpOnly cookies
 * flow to the Rust backend. JSON responses are parsed; non-OK statuses throw
 * an { status, code, message, details } error shaped like the API envelope.
 */

export interface ApiError extends Error {
  status: number
  code: string
  details?: unknown
}

function makeError(status: number, code: string, message: string, details?: unknown): ApiError {
  const e = new Error(message) as ApiError
  e.status = status
  e.code = code
  e.details = details
  e.name = 'ApiError'
  return e
}

/** Fetch wrapper that targets the Rust backend (same origin). */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers)
  // Default to JSON for bodies that look like JSON.
  if (init.body && !headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }
  // Default request timeout: 15s. Without this, a hung backend connection
  // (TCP open but no response) stalls the UI forever — the user stares at a
  // spinner with no way to recover short of a reload. AbortSignal.timeout()
  // aborts the fetch and throws a DOMException named "TimeoutError", which
  // callers can map to a friendly "Mất kết nối" toast.
  //
  // Callers that need a longer window (file uploads, long polling) pass
  // their own `init.signal` — when present, we DON'T inject a timeout, so the
  // caller stays in full control of the request lifecycle.
  const signal = init.signal ?? AbortSignal.timeout(15_000)
  // Path is relative (e.g. "/api/brands") — resolves to the same origin
  // the SPA was served from (the Rust backend).
  return fetch(path, {
    ...init,
    headers,
    signal,
    credentials: 'include', // send httpOnly JWT cookies to the Rust backend
  })
}

/** Convenience: fetch + parse JSON, throw ApiError on non-OK. */
export async function apiJson<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await apiFetch(path, init)
  if (!res.ok) {
    let code = 'ERROR'
    let message = `HTTP ${res.status}`
    let details: unknown
    try {
      const body = await res.json()
      code = body?.error?.code ?? code
      message = body?.error?.message ?? message
      details = body?.error?.details
    } catch {
      // non-JSON error body
    }
    throw makeError(res.status, code, message, details)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

/** Whether the app is routing API calls to the Rust backend. Always true now
 *  — the SPA is served from the Rust backend, so all API calls are same-origin. */
export const isRustBackend = true
