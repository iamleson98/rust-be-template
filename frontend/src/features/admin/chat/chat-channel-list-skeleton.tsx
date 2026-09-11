'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Chat Channel List Skeleton ───
 * Mirrors the chat queue rows: avatar + display name/subtitle lines +
 * unread badge + timestamp.
 */
export const ChatChannelListSkeleton = memo(function ChatChannelListSkeleton({
  count = 6,
}: {
  count?: number
}) {
  return (
    <div className="divide-y" aria-hidden data-testid="chat-channels-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-4">
          <Shimmer className="h-10 w-10 rounded-full shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Shimmer className="h-4 w-32" />
            <Shimmer className="h-3 w-44" style={{ opacity: 1 - i * 0.12 }} />
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <Shimmer className="h-3 w-10" />
            <Shimmer className="h-4 w-5 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
})
