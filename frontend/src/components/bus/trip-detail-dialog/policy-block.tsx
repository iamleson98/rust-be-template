'use client'

/**
 * PolicyBlock — small two-column policy list used inside the
 * "Chính sách" tab of the TripDetailDialog.
 *
 * Extracted verbatim from the original `trip-detail-dialog.tsx`
 * (lines 1704-1718). Pure refactor.
 */

export function PolicyBlock({ title, items }: { title: string; items: { label: string; value: string }[] }) {
  return (
    <div>
      <h4 className="font-semibold text-sm mb-2">{title}</h4>
      <div className="rounded-lg border bg-white divide-y">
        {items.map((it, i) => (
          <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
            <span className="text-muted-foreground">{it.label}</span>
            <span className="font-medium">{it.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
