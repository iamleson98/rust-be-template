'use client'

/**
 * City select content + helpers for RouteFormDialog — the grouped
 * Vietnamese-city dropdown (Miền Bắc / Trung / Nam) and the slug → display
 * name lookup used by the SelectValue render-prop.
 *
 * Extracted from the original 'src/features/admin/routes/route-form.tsx'.
 */

import {
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
} from '@/components/ui/select'
import {
  VIETNAMESE_CITIES,
} from '@/lib/vietnamese-cities'

// Group cities by region for the Select dropdown.
const NORTH = VIETNAMESE_CITIES.filter((c) => c.region === 'north')
const CENTRAL = VIETNAMESE_CITIES.filter((c) => c.region === 'central')
const SOUTH = VIETNAMESE_CITIES.filter((c) => c.region === 'south')

// Map city id (slug) → display name. Used by the SelectValue render-prop
// so the trigger shows "Hà Nội" instead of the raw slug "ha-noi" — Base
// UI unmounts SelectContent (and thus the SelectItems) when the popover
// closes, so it can no longer look up the label by matching the value.
// The slug is the only stable identifier we have, so we look it up in
// this side table instead.
const CITY_NAME_BY_ID = new Map<string, string>(
  VIETNAMESE_CITIES.map((c) => [c.id, c.name]),
)

export function cityLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return CITY_NAME_BY_ID.get(value) ?? null
}

export function CitySelectContent() {
  return (
    <SelectContent className="max-h-80">
      <SelectGroup>
        <SelectLabel className="text-xs font-semibold uppercase text-blue-600">
          Miền Bắc
        </SelectLabel>
        {NORTH.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectGroup>
      <SelectGroup>
        <SelectLabel className="text-xs font-semibold uppercase text-amber-600">
          Miền Trung
        </SelectLabel>
        {CENTRAL.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectGroup>
      <SelectGroup>
        <SelectLabel className="text-xs font-semibold uppercase text-emerald-600">
          Miền Nam
        </SelectLabel>
        {SOUTH.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectGroup>
    </SelectContent>
  )
}
