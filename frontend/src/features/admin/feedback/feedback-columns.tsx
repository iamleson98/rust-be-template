'use client'

/**
 * Column model for the admin feedback panel's DataTable — customer,
 * rating, content preview, status, date.
 *
 * Extracted from the original 'src/features/admin/feedback/feedback-panel.tsx'.
 */

import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { DataTableColumnHeader, type DataTableFeatures } from '@/components/data-table'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { StarRating } from '@/features/feedback/star-rating'
import { StatusBadge } from './feedback-status-badge'
import { formatDate, type FeedbackRow } from './helpers'

const feedbackColumnHelper = createColumnHelper<DataTableFeatures, FeedbackRow>()

export function useFeedbackColumns() {
  return useMemo(
    () =>
      feedbackColumnHelper.columns([
        feedbackColumnHelper.accessor('authorName', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Khách hàng" />,
          cell: ({ row }) => {
            const name = row.original.authorName || 'Ẩn danh'
            const phone = row.original.authorPhone
            return (
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar className="size-8 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-primary text-[11px] font-bold">
                    {name.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{name}</div>
                  {phone && (
                    <div className="truncate text-[11px] text-muted-foreground">{phone}</div>
                  )}
                </div>
              </div>
            )
          },
          meta: { label: 'Khách hàng' },
        }),
        feedbackColumnHelper.accessor('rating', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Đánh giá" />,
          cell: ({ getValue }) => <StarRating value={getValue() as number} size="sm" />,
          meta: { label: 'Đánh giá' },
        }),
        feedbackColumnHelper.accessor('title', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Nội dung" />,
          cell: ({ row }) => {
            const r = row.original
            return (
              <div className="max-w-80 space-y-1">
                {r.title && <div className="text-sm font-medium truncate">{r.title}</div>}
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {r.content || '—'}
                </p>
                {(r.tags?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(r.tags ?? []).slice(0, 3).map((t) => (
                      <Badge key={t} variant="secondary" className="text-[9px] font-normal px-1.5">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )
          },
          meta: { label: 'Nội dung' },
        }),
        feedbackColumnHelper.accessor('status', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Trạng thái" />,
          cell: ({ getValue }) => <StatusBadge status={getValue() as string} />,
          meta: { label: 'Trạng thái' },
        }),
        feedbackColumnHelper.accessor('createdAt', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Thời gian" />,
          cell: ({ getValue }) => (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatDate(getValue() as string)}
            </span>
          ),
          meta: { label: 'Thời gian' },
        }),
      ]),
    [],
  )
}
