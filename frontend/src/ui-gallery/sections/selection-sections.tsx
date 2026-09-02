import { useState } from 'react'

import { Calendar } from '@/components/ui/calendar'
import { DatePicker } from '@/components/ui/date-picker'
import { TimePicker } from '@/components/ui/time-picker'
import { InfiniteSelect } from '@/components/ui/infinite-select'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@/components/ui/combobox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

import { Mirror, Section } from '../section'

const VEHICLE_TYPES = [
  { value: 'seater', label: 'Ghế ngồi (Seater)' },
  { value: 'sleeper', label: 'Giường nằm (Sleeper)' },
  { value: 'limousine', label: 'Limousine' },
  { value: 'double-decker', label: 'Xe giường đôi' },
]

const CITIES = [
  { value: 'ha-noi', label: 'Hà Nội' },
  { value: 'ho-chi-minh', label: 'Hồ Chí Minh' },
  { value: 'da-nang', label: 'Đà Nẵng' },
  { value: 'da-lat', label: 'Đà Lạt' },
  { value: 'hue', label: 'Huế' },
  { value: 'hai-phong', label: 'Hải Phòng' },
]

/**
 * Mock paginated backend for the InfiniteSelect demo: 120 synthetic
 * rows, 10 per page, case-insensitive label filter.
 */
async function galleryFetchPage(page: number, search: string) {
  const all = Array.from({ length: 120 }, (_, i) => ({
    value: `city-${i + 1}`,
    label: `City ${i + 1}`,
  }))
  const needle = search.trim().toLowerCase()
  const filtered = needle
    ? all.filter((c) => c.label.toLowerCase().includes(needle))
    : all
  const pageSize = 10
  const items = filtered.slice(page * pageSize, (page + 1) * pageSize)
  return { items, total: filtered.length, hasMore: (page + 1) * pageSize < filtered.length }
}

/**
 * Selection base components: Select, Combobox, Toggle, ToggleGroup,
 * Calendar.
 */
export function SelectionSections() {
  const [vehicle, setVehicle] = useState('')
  const [city, setCity] = useState<string | null>(null)
  const [pinned, setPinned] = useState(false)
  const [view, setView] = useState('list')
  const [date, setDate] = useState<Date | undefined>(new Date())
  const [isoDate, setIsoDate] = useState<string | null>(null)
  const [time, setTime] = useState<string | null>('08:30')
  const [pagedCity, setPagedCity] = useState<string | null>(null)

  return (
    <>
      <Section
        id="select"
        title="Select"
        description="Fixed-option dropdown with keyboard navigation."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Select value={vehicle} onValueChange={setVehicle}>
            <SelectTrigger className="w-56" data-testid="select-trigger">
              <SelectValue placeholder="Choose vehicle type" />
            </SelectTrigger>
            <SelectContent data-testid="select-content">
              {VEHICLE_TYPES.map((v) => (
                <SelectItem
                  key={v.value}
                  value={v.value}
                  textValue={v.label}
                  data-testid={`select-item-${v.value}`}
                >
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm">
            Vehicle: <Mirror testId="select-mirror">{vehicle || 'none'}</Mirror>
          </span>
        </div>
      </Section>

      <Section
        id="combobox"
        title="Combobox"
        description="Searchable dropdown — type to filter the list."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Combobox
            value={city}
            onValueChange={(v) => setCity(v as string | null)}
            items={CITIES}
          >
            <ComboboxTrigger className="w-56" data-testid="combobox-trigger">
              <ComboboxValue placeholder="Pick a destination…" />
            </ComboboxTrigger>
            <ComboboxContent data-testid="combobox-content">
              <ComboboxInput
                placeholder="Search cities…"
                data-testid="combobox-input"
              />
              <ComboboxList>
                {CITIES.map((c) => (
                  <ComboboxItem
                    key={c.value}
                    value={c.value}
                    data-testid={`combobox-item-${c.value}`}
                  >
                    {c.label}
                  </ComboboxItem>
                ))}
                <ComboboxEmpty data-testid="combobox-empty">
                  No matching city.
                </ComboboxEmpty>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <span className="text-sm">
            Destination: <Mirror testId="combobox-mirror">{city ?? 'none'}</Mirror>
          </span>
        </div>
      </Section>

      <Section
        id="toggle"
        title="Toggle"
        description="Two-state icon button (pressed / not pressed)."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Toggle
            variant="outline"
            size="sm"
            pressed={pinned}
            onPressedChange={setPinned}
            aria-label="Toggle pin"
            data-testid="toggle-demo"
          >
            ★ Pinned
          </Toggle>
          <span className="text-sm">
            Pinned: <Mirror testId="toggle-mirror">{String(pinned)}</Mirror>
          </span>
        </div>
      </Section>

      <Section
        id="toggle-group"
        title="ToggleGroup"
        description="Grouped single-choice toggles (view switcher)."
      >
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            variant="outline"
            type="single"
            value={view}
            onValueChange={(v) => {
              const val = Array.isArray(v) ? v[0] : v
              if (val) setView(val)
            }}
            data-testid="toggle-group-demo"
          >
            <ToggleGroupItem value="list" data-testid="toggle-group-list">
              List
            </ToggleGroupItem>
            <ToggleGroupItem value="grid" data-testid="toggle-group-grid">
              Grid
            </ToggleGroupItem>
            <ToggleGroupItem value="map" data-testid="toggle-group-map">
              Map
            </ToggleGroupItem>
          </ToggleGroup>
          <span className="text-sm">
            View: <Mirror testId="toggle-group-mirror">{view}</Mirror>
          </span>
        </div>
      </Section>

      <Section
        id="calendar"
        title="Calendar"
        description="Month grid date picker (react-day-picker)."
      >
        <div className="flex flex-wrap items-start gap-4">
          <div data-testid="calendar-demo">
            <Calendar
              mode="single"
              selected={date}
              onSelect={setDate}
              className="rounded-md border"
            />
          </div>
          <span className="text-sm">
            Selected departure:{' '}
            <Mirror testId="calendar-mirror">
              {date ? date.toLocaleDateString('en-GB') : 'none'}
            </Mirror>
          </span>
        </div>
      </Section>

      <Section
        id="date-picker"
        title="DatePicker"
        description="Popover + Calendar single-date picker (yyyy-MM-dd value)."
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-64" data-testid="date-picker-demo">
            <DatePicker value={isoDate} onChange={setIsoDate} placeholder="Pick a date…" />
          </div>
          <span className="text-sm">
            ISO: <Mirror testId="date-picker-mirror">{isoDate ?? 'null'}</Mirror>
          </span>
        </div>
      </Section>

      <Section
        id="time-picker"
        title="TimePicker"
        description="Popover + hour/minute selects, HH:MM value."
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-40" data-testid="time-picker-demo">
            <TimePicker value={time} onChange={setTime} />
          </div>
          <span className="text-sm">
            Time: <Mirror testId="time-picker-mirror">{time ?? 'null'}</Mirror>
          </span>
        </div>
      </Section>

      <Section
        id="infinite-select"
        title="InfiniteSelect"
        description="Searchable select that pages data as you scroll (mock backend)."
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-64" data-testid="infinite-select-demo">
            <InfiniteSelect
              scope="gallery-cities"
              fetchPage={galleryFetchPage}
              value={pagedCity}
              onValueChange={setPagedCity}
              itemValue={(c) => c.value}
              itemLabel={(c) => c.label}
              placeholder="Scroll to load more…"
              searchPlaceholder="Search cities…"
            />
          </div>
          <span className="text-sm">
            City: <Mirror testId="infinite-select-mirror">{pagedCity ?? 'null'}</Mirror>
          </span>
        </div>
      </Section>
    </>
  )
}
