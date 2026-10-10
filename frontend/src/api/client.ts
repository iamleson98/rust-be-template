import { client } from './generated/client.gen'
import { createAuthFetch } from './auth-fetch'

/**
 * Point the generated SDK at the backend. In the browser requests stay
 * same-origin (Vite proxy in dev, Axum in prod) so SameSite cookies are sent;
 * SSR/prerender has no origin and needs an absolute URL.
 */
export function configureApiClient() {
  client.setConfig({
    baseUrl:
      typeof window !== 'undefined'
        ? ''
        : (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8080'),
    credentials: 'include',
    fetch: createAuthFetch(),
  })
}
