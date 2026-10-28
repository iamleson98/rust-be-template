/**
 * OAuth 2.0 social sign-in — Google and Facebook, the port of Rust
 * `auth/oauth/{mod,google,facebook}.rs` and `routes/oauth.rs`.
 *
 * Flow: `start` sets a random `state` in a short-lived cookie and redirects to
 * the provider; `callback` checks the cookie against the `state` query value
 * (login-CSRF defence), exchanges the code, reads the profile and signs the
 * linked or new account in. Every callback failure redirects to the frontend's
 * login page with `?oauth_error=<message>` instead of showing a JSON error.
 */
import { getEnv } from "@/lib/db/client";
import type { OAuthProfile } from "./auth-service";

export const OAUTH_PROVIDERS = ["google", "facebook"] as const;
export type OAuthProviderName = (typeof OAUTH_PROVIDERS)[number];

/** Lifetime of the `oauth_state_<provider>` cookie. */
export const STATE_COOKIE_TTL_SECS = 600;
export const stateCookieName = (provider: string) => `oauth_state_${provider}`;

/** Rust `urlencoding::encode`: everything but the RFC 3986 unreserved characters. */
export const urlEncode = (s: string): string =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** 32 random bytes as 43 URL-safe base64 characters (Rust `generate_state`). */
export function generateState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** `{redirect_base_url}/api/auth/oauth/{provider}/callback` */
export function callbackUrl(redirectBaseUrl: string, provider: string): string {
  return `${redirectBaseUrl.replace(/\/+$/, "")}/api/auth/oauth/${provider}/callback`;
}

interface ProviderConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  scopes: string;
}

interface ProviderSpec {
  authUrl: string;
  tokenUrl: string;
  profileUrl: string;
  defaultScopes: string;
  /** Extra authorization-URL query (Google asks for a refresh grant and consent). */
  authExtra: string;
}

const SPECS: Record<OAuthProviderName, ProviderSpec> = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    profileUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
    defaultScopes: "openid email profile",
    authExtra: "&access_type=offline&prompt=consent",
  },
  facebook: {
    authUrl: "https://www.facebook.com/v18.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v18.0/oauth/access_token",
    profileUrl: "https://graph.facebook.com/v18.0/me",
    defaultScopes: "email public_profile",
    authExtra: "",
  },
};

const HTTP_TIMEOUT_MS = 10_000;

export interface OAuthProvider {
  name: OAuthProviderName;
  authorizationUrl(state: string, redirectUri: string): string;
  /** Authorization code → provider access token. */
  exchangeCode(code: string, redirectUri: string): Promise<string>;
  fetchProfile(accessToken: string): Promise<OAuthProfile>;
}

async function getJson(res: Response, what: string): Promise<Record<string, unknown>> {
  if (!res.ok) throw new Error(`${what} failed (${res.status})`);
  return (await res.json()) as Record<string, unknown>;
}

function provider(name: OAuthProviderName, cfg: ProviderConfig): OAuthProvider {
  const spec = SPECS[name];
  const scopes = cfg.scopes || spec.defaultScopes;
  return {
    name,
    authorizationUrl: (state, redirectUri) =>
      `${spec.authUrl}?client_id=${urlEncode(cfg.clientId)}&redirect_uri=${urlEncode(redirectUri)}` +
      `&state=${urlEncode(state)}&scope=${urlEncode(scopes)}&response_type=code${spec.authExtra}`,

    async exchangeCode(code, redirectUri) {
      const credentials = {
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: redirectUri,
        code,
      };
      const signal = AbortSignal.timeout(HTTP_TIMEOUT_MS);
      // Google takes a form body; Facebook takes the same fields in the query.
      const res =
        name === "google"
          ? await fetch(spec.tokenUrl, {
              method: "POST",
              body: new URLSearchParams({ ...credentials, grant_type: "authorization_code" }),
              signal,
            })
          : await fetch(`${spec.tokenUrl}?${new URLSearchParams(credentials)}`, {
              method: "POST",
              signal,
            });
      const token = (await getJson(res, `${name} token exchange`)).access_token;
      if (typeof token !== "string") throw new Error(`${name} token parse`);
      return token;
    },

    async fetchProfile(accessToken) {
      const signal = AbortSignal.timeout(HTTP_TIMEOUT_MS);
      if (name === "google") {
        const p = await getJson(
          await fetch(spec.profileUrl, {
            headers: { authorization: `Bearer ${accessToken}` },
            signal,
          }),
          "google profile fetch",
        );
        // An unverified address must not be bound to a local account: anyone
        // could register someone else's email at Google and take it over.
        if (p.email_verified === false) throw new Error("Google email is not verified");
        if (typeof p.sub !== "string" || typeof p.email !== "string") {
          throw new Error("google profile parse");
        }
        return {
          provider: name,
          subject: p.sub,
          email: p.email,
          name: typeof p.name === "string" ? p.name : "Người dùng Google",
          avatarUrl: typeof p.picture === "string" ? p.picture : null,
        };
      }
      const query = new URLSearchParams({
        fields: "id,name,email,picture",
        access_token: accessToken,
      });
      const p = await getJson(await fetch(`${spec.profileUrl}?${query}`, { signal }), "fb profile");
      if (typeof p.email !== "string") throw new Error("Facebook did not return an email");
      if (typeof p.id !== "string" || typeof p.name !== "string")
        throw new Error("fb profile parse");
      const picture = (p.picture as { data?: { url?: unknown } } | undefined)?.data?.url;
      return {
        provider: name,
        subject: p.id,
        email: p.email,
        name: p.name,
        avatarUrl: typeof picture === "string" ? picture : null,
      };
    },
  };
}

function providerConfig(env: CloudflareEnv, name: OAuthProviderName): ProviderConfig {
  const [enabled, clientId, clientSecret, scopes] =
    name === "google"
      ? [
          env.OAUTH_GOOGLE_ENABLED,
          env.OAUTH_GOOGLE_CLIENT_ID,
          env.OAUTH_GOOGLE_CLIENT_SECRET,
          env.OAUTH_GOOGLE_SCOPES,
        ]
      : [
          env.OAUTH_FACEBOOK_ENABLED,
          env.OAUTH_FACEBOOK_CLIENT_ID,
          env.OAUTH_FACEBOOK_CLIENT_SECRET,
          env.OAUTH_FACEBOOK_SCOPES,
        ];
  return {
    // Rust parses the switch as a bool: only the literal "true" turns it on.
    enabled: enabled === "true",
    clientId: clientId ?? "",
    clientSecret: clientSecret ?? "",
    scopes: scopes ?? "",
  };
}

/**
 * Rust `enabled_provider`: the provider behind `name` when it is switched on
 * (`OAUTH_<P>_ENABLED=true`) and has both its client id and secret.
 */
export async function enabledProvider(name: string): Promise<OAuthProvider | null> {
  if (!(OAUTH_PROVIDERS as readonly string[]).includes(name)) return null;
  const cfg = providerConfig(await getEnv(), name as OAuthProviderName);
  if (!cfg.enabled || !cfg.clientId || !cfg.clientSecret) return null;
  return provider(name as OAuthProviderName, cfg);
}

/** Providers the sign-in page should offer. */
export async function enabledProviderNames(): Promise<OAuthProviderName[]> {
  const found = await Promise.all(OAUTH_PROVIDERS.map(enabledProvider));
  return OAUTH_PROVIDERS.filter((_, i) => found[i]);
}
