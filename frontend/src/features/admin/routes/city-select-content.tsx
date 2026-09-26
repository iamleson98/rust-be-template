'use client'

/**
 * City items + helpers for the route forms — the grouped Vietnamese-city
 * collection (Miền Bắc / Trung / Nam) used by the searchable city
 * comboboxes, and the slug → display name lookup for places that render
 * a stored city slug as text.
 *
 * Extracted from the original 'src/features/admin/routes/route-form.tsx'
 * (originally a Select dropdown; now feeds ComboboxField groups).
 */

import type {
  ComboboxFieldGroup,
  ComboboxFieldItem,
} from '@/components/ui/combobox'
import { useT } from '@/lib/i18n'
import { VIETNAMESE_CITIES } from '@/lib/vietnamese-cities'

// Group cities by region for the grouped combobox.
const NORTH = VIETNAMESE_CITIES.filter((c) => c.region === 'north')
const CENTRAL = VIETNAMESE_CITIES.filter((c) => c.region === 'central')
const SOUTH = VIETNAMESE_CITIES.filter((c) => c.region === 'south')

const toItem = (c: { id: string; name: string }): ComboboxFieldItem => ({
  value: c.id,
  label: c.name,
})

/** Grouped city items for ComboboxField (Miền Bắc / Trung / Nam).
 *  Region labels are translated — city names are proper nouns and
 *  stay as-is. */
export const getCityGroups = (t: ReturnType<typeof useT>): ComboboxFieldGroup[] => [
  { label: t('adminRoutes.regionNorth'), items: NORTH.map(toItem) },
  { label: t('adminRoutes.regionCentral'), items: CENTRAL.map(toItem) },
  { label: t('adminRoutes.regionSouth'), items: SOUTH.map(toItem) },
]

/** Flat city items (value = city slug, label = display name). */
export const CITY_ITEMS: ComboboxFieldItem[] = VIETNAMESE_CITIES.map(toItem)

// Map city id (slug) → display name. Used where a stored slug must be
// rendered as text (the combobox resolves the trigger label itself).
const CITY_NAME_BY_ID = new Map<string, string>(
  VIETNAMESE_CITIES.map((c) => [c.id, c.name]),
)

export function cityLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return CITY_NAME_BY_ID.get(value) ?? null
}
