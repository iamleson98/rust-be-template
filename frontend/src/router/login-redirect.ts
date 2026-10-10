/**
 * Where to go back to after signing in. Only in-app paths are kept, so a crafted
 * link cannot bounce a fresh session to another site (`//evil.example`).
 */
export function safeRedirect(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return undefined
  if (raw.startsWith('//') || raw.startsWith('/\\') || /^\/login(\?|$)/.test(raw)) return undefined
  return raw
}

/** `/login` search params. */
export const loginSearch = (raw: Record<string, unknown>): { redirect?: string } => {
  const redirect = safeRedirect(raw.redirect)
  return redirect ? { redirect } : {}
}
