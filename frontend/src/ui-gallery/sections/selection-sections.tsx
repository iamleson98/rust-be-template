import { useState } from 'react'

import { Calendar } from '@/components/ui/calendar'
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
 * Selection base components: Select, Combobox, Toggle, ToggleGroup,
 * Calendar.
 */
export function SelectionSections() {
  const [vehicle, setVehicle] = useState('')
  const [city, setCity] = useState<string | null>(null)
  const [pinned, setPinned] = useState(false)
  const [view, setView] = useState('list')
  const [date, setDate] = useState<Date | undefined>(new Date())

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
    </>
  )
}
