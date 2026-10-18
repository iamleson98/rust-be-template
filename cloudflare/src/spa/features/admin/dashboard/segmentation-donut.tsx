/**
 * Donut chart segment shape — shared by the dashboard donut cards
 * (booking-status breakdown, and any future segment-driven card).
 * The interactive `SegmentationDonut` component that used to live here
 * was removed with the mock `CUSTOMER_SEGMENTS` data — the live cards
 * render their own inline SVG (see `booking-status-donut-card.tsx`).
 */

export type DonutSegment = {
  label: string
  count: number
  color: string
}
