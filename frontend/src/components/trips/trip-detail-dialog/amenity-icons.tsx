'use client'

/**
 * Amenity icon map + helpers shared across the TripDetailDialog tabs.
 *
 * Extracted verbatim from the original `trip-detail-dialog.tsx`
 * (lines 168-173). JSX lives in this `.tsx` file so the `types.ts`
 * file can stay pure-TS.
 */

import type { ReactNode } from 'react'
import { Wifi, Snowflake, Droplet, Zap } from 'lucide-react'

/** Maps amenity keys (wifi/ac/water/charging) → lucide icon nodes. */
export const amenityIcon: Record<string, ReactNode> = {
  wifi: <Wifi className="h-4 w-4" />,
  ac: <Snowflake className="h-4 w-4" />,
  water: <Droplet className="h-4 w-4" />,
  charging: <Zap className="h-4 w-4" />,
}
