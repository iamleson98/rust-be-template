"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * Combobox — searchable dropdown built on Base UI's Combobox primitive.
 *
 * Use Combobox instead of Select when the user needs to TYPE to filter
 * the list (e.g. picking from hundreds of places, brands, or routes).
 * Select is for short, fixed lists where a button click is enough.
 *
 * ## API
 *
 * ```tsx
 * <Combobox>
 *   <ComboboxTrigger>
 *     <ComboboxValue placeholder="Chọn địa điểm..." />
 *   </ComboboxTrigger>
 *   <ComboboxContent>
 *     <ComboboxInput placeholder="Tìm..." />
 *     <ComboboxList>
 *       <ComboboxItem value="hanoi">Hà Nội</ComboboxItem>
 *       <ComboboxItem value="hcm">Hồ Chí Minh</ComboboxItem>
 *       <ComboboxEmpty>Không tìm thấy</ComboboxEmpty>
 *     </ComboboxList>
 *   </ComboboxContent>
 * </Combobox>
 * ```
 *
 * ## Base UI notes
 *
 * - `ComboboxValue` does NOT render its own HTML element — it's a
 *   text-only component. Place it inside the `ComboboxTrigger`.
 * - `ComboboxItem` renders children directly (no `ItemText` wrapper).
 * - `ComboboxEmpty` requires the `items` prop on the Root to work
 *   (it compares against the item count). Without `items`, render
 *   an empty state manually inside the list.
 */

const Combobox = ComboboxPrimitive.Root

function ComboboxValue({
  placeholder,
  children,
}: React.ComponentProps<typeof ComboboxPrimitive.Value>) {
  // ComboboxValue doesn't render its own element — it's a text-only
  // component. We wrap it in a span so it can be laid out inside the
  // trigger button.
  return (
    <span className="flex flex-1 text-left">
      <ComboboxPrimitive.Value data-slot="combobox-value" placeholder={placeholder}>
        {children}
      </ComboboxPrimitive.Value>
    </span>
  )
}

function ComboboxTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Trigger>) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        "border-input data-placeholder:text-muted-foreground",
        "[&_svg:not([class*='text-'])]:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-ring/50",
        "flex w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap  transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        "h-9",
        className,
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.Icon>
        <ChevronDownIcon className="pointer-events-none size-4 opacity-50" />
      </ComboboxPrimitive.Icon>
    </ComboboxPrimitive.Trigger>
  )
}

function ComboboxInput({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Input>) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        "border-input placeholder:text-muted-foreground h-9 w-full cursor-text border-b bg-transparent px-3 py-2 text-sm outline-none",
        className,
      )}
      {...props}
    />
  )
}

function ComboboxContent({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Popup> &
  Pick<
    React.ComponentProps<typeof ComboboxPrimitive.Positioner>,
    "side" | "align" | "sideOffset" | "alignOffset"
  >) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="z-50"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "bg-popover text-popover-foreground",
            "relative z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-hidden rounded-md border ",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.List>) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn("max-h-72 overflow-y-auto overscroll-contain p-1", className)}
      {...props}
    />
  )
}

function ComboboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Item>) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground",
        "data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        "hover:bg-accent hover:text-accent-foreground",
        "transition-colors duration-150",
        "relative flex w-full cursor-pointer items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="size-4" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

function ComboboxEmpty({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Empty>) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn("py-2 text-center text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

// ─────────────────────────────────────────────────────────────
// ComboboxField — a Select-compatible searchable dropdown
// ─────────────────────────────────────────────────────────────

/**
 * ComboboxField — the drop-in replacement for `Select` used across
 * the app. Same mental model (`value` + `onValueChange` + declarative
 * items), but the popup carries a search input so long lists (cities,
 * brands, routes, layouts…) can be typed-to-filter instead of
 * scroll-hunted.
 *
 * ## API
 *
 * ```tsx
 * // Flat items
 * <ComboboxField
 *   value={status}
 *   onValueChange={setStatus}
 *   items={[
 *     { value: "active", label: "Hoạt động" },
 *     { value: "inactive", label: "Ẩn" },
 *   ]}
 * />
 *
 * // Grouped items (e.g. Vietnamese cities by region)
 * <ComboboxField
 *   value={city}
 *   onValueChange={setCity}
 *   items={[
 *     { label: "Miền Bắc", items: [{ value: "ha-noi", label: "Hà Nội" }] },
 *     { label: "Miền Nam", items: [{ value: "sg", label: "TP. Hồ Chí Minh" }] },
 *   ]}
 * />
 * ```
 *
 * ## Implementation notes
 *
 * - The `items` collection is passed to Base UI's Combobox root, which
 *   gives us three things for free: client-side label filtering as the
 *   user types (collator-aware substring match on the item label),
 *   the `ComboboxEmpty` no-match state, and automatic selected-label
 *   resolution in the trigger (`ComboboxValue`).
 * - Groups render through `ComboboxGroup` + `ComboboxGroupLabel`. Base
 *   UI hides non-matching ITEMS but keeps empty group labels mounted,
 *   so we track the query ourselves (`onInputValueChange`) and stop
 *   rendering a group once none of its items match.
 */
export type ComboboxFieldItem = {
  value: string
  label: string
  disabled?: boolean
}

export type ComboboxFieldGroup = {
  label: string
  items: ComboboxFieldItem[]
}

type ComboboxFieldProps = {
  /** Currently selected value (the item's `value`, like Select). */
  value: string | null | undefined
  /** Called with the newly selected item's value. */
  onValueChange: (value: string) => void
  /** Flat or grouped item collection. */
  items: ComboboxFieldItem[] | ComboboxFieldGroup[]
  /** Trigger placeholder when nothing is selected. */
  placeholder?: string
  /** Search input placeholder inside the popup. */
  searchPlaceholder?: string
  /** Text shown when no item matches the query. */
  emptyText?: string
  disabled?: boolean
  /** Extra classes for the trigger (width, height…). */
  className?: string
  /** Extra classes for the popup content. */
  contentClassName?: string
  /** Optional aria-label for the trigger. */
  "aria-label"?: string
  /** Test id forwarded to the trigger. */
  "data-testid"?: string
}

const isGrouped = (
  items: ComboboxFieldItem[] | ComboboxFieldGroup[],
): items is ComboboxFieldGroup[] =>
  items.length > 0 && "items" in (items[0] as ComboboxFieldGroup)

export function ComboboxField({
  value,
  onValueChange,
  items,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
  className,
  contentClassName,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: ComboboxFieldProps) {
  const t = useT()
  const groups = isGrouped(items) ? items : null
  const flat = groups ? null : (items as ComboboxFieldItem[])
  // Track the live query so empty groups can be unmounted (Base UI
  // hides filtered-out items but leaves group labels in the DOM).
  const [query, setQuery] = React.useState("")
  const needle = query.trim().toLowerCase()

  const groupMatches = (group: ComboboxFieldGroup) =>
    !needle ||
    group.items.some(
      (item) => item.label.toLowerCase().includes(needle),
    )

  return (
    <Combobox
      value={value ?? null}
      onValueChange={(v) => {
        // Single-select combobox: the value is the item's value or null.
        onValueChange((v as string | null) ?? "")
      }}
      onInputValueChange={(input) => setQuery(input ?? "")}
      // The items collection powers label filtering, the empty state
      // and trigger label resolution. Base UI accepts flat
      // {value,label} arrays or grouped {label, items} collections.
      items={items as unknown as readonly Record<string, unknown>[]}
      disabled={disabled}
    >
      <ComboboxTrigger
        className={className}
        aria-label={ariaLabel}
        data-testid={testId}
      >
        <ComboboxValue placeholder={placeholder ?? t("combobox.choose")} />
      </ComboboxTrigger>
      <ComboboxContent className={contentClassName}>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <ComboboxInput
            placeholder={searchPlaceholder ?? t("combobox.search")}
            className="h-8 border-b pl-8 text-sm"
          />
        </div>
        <ComboboxList>
          {groups
            ? groups
                .filter(groupMatches)
                .map((group) => (
                  <ComboboxPrimitive.Group
                    key={group.label}
                    className="combobox-field-group"
                  >
                    <ComboboxPrimitive.GroupLabel className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </ComboboxPrimitive.GroupLabel>
                    {group.items.map((item) => (
                      <ComboboxFieldItemRow key={item.value} item={item} />
                    ))}
                  </ComboboxPrimitive.Group>
                ))
            : flat?.map((item) => (
                <ComboboxFieldItemRow key={item.value} item={item} />
              ))}
          <ComboboxEmpty>{emptyText ?? t("combobox.noMatch")}</ComboboxEmpty>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

function ComboboxFieldItemRow({ item }: { item: ComboboxFieldItem }) {
  return (
    <ComboboxItem value={item.value} disabled={item.disabled}>
      {item.label}
    </ComboboxItem>
  )
}

export {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
}
