/**
 * Shared helpers for the admin routes page.
 *
 * Extracted from the original 'src/routes/admin/routes.tsx'.
 */

import { VIETNAMESE_CITIES } from '@/lib/vietnamese-cities'

const CITY_NAME_BY_ID = new Map<string, string>(VIETNAMESE_CITIES.map((c) => [c.id, c.name]))

export const cityLabel = (slug: string | null | undefined) =>
  slug ? CITY_NAME_BY_ID.get(slug) ?? slug : '—'
