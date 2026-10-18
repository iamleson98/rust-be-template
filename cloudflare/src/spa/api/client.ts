import { client } from "./generated/client.gen";
import { createAuthFetch } from "./auth-fetch";

/**
 * Point the generated SDK at the backend. In the browser requests stay
 * same-origin (Vite proxy in dev, Axum in prod) so SameSite cookies are sent;
 * SSR/prerender has no origin and needs an absolute URL.
 */
export function configureApiClient() {
  client.setConfig({
    // Same-origin relative URLs: Next.js serves the API routes (/api/*)
    // from the same host, so SameSite cookies flow naturally.
    baseUrl: "",
    credentials: "include",
    fetch: createAuthFetch(),
  });
}
