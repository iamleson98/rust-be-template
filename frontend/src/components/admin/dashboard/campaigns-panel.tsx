'use client'

/**
 * CampaignsPanel — admin "Khuyến mãi" tab content.
 *
 * Migrated from receiving `campaigns` as a prop to fetching them directly
 * via the `useCampaigns()` TanStack Query hook. The hook is shared with
 * any other component that reads campaigns (e.g. the homepage Flash Sale
 * section) — TanStack Query deduplicates by queryKey, so mounting this
 * panel doesn't trigger a duplicate request.
 *
 * The table itself is the shared DataTable (TanStack Table) with
 * client-side sorting; loading / error / empty states are handled by the
 * DataTable's built-in slots (Vietnamese strings + retry button).
 */

import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { CheckCircle2, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable, DataTableColumnHeader, type DataTableFeatures } from '@/components/data-table'
import { formatNum } from '@/lib/types'
import { useCampaigns } from '@/lib/queries'
import type { AdminCampaignRow as Campaign } from './types'

const columnHelper = createColumnHelper<DataTableFeatures, Campaign>()

export function CampaignsPanel() {
  const { data, isLoading, isError, refetch } = useCampaigns()
  const campaigns: Campaign[] = (data?.items ?? []) as unknown as Campaign[]

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('code', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Mã" />,
          cell: ({ getValue }) => (
            <code className="font-mono font-bold text-blue-700 dark:text-blue-400">{getValue()}</code>
          ),
          sortFn: 'text',
          meta: { label: 'Mã' },
        }),
        columnHelper.accessor('name', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Tên" />,
          cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
          sortFn: 'text',
          meta: { label: 'Tên' },
        }),
        columnHelper.accessor((row) => row.brand?.name ?? 'Toàn nền tảng', {
          id: 'brand',
          header: ({ column }) => <DataTableColumnHeader column={column} title="Hãng" />,
          sortFn: 'text',
          meta: { label: 'Hãng', cellClassName: 'hidden md:table-cell' },
        }),
        columnHelper.accessor('usedCount', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Lượt dùng" />,
          cell: ({ getValue }) => (
            <span className="font-medium tabular-nums">{formatNum(getValue())}</span>
          ),
          sortFn: 'basic',
          meta: { label: 'Lượt dùng', align: 'right' },
        }),
        columnHelper.accessor('usageLimitTotal', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Giới hạn" />,
          cell: ({ getValue }) => (
            <span className="tabular-nums text-muted-foreground">
              {getValue() > 0 ? formatNum(getValue()) : '∞'}
            </span>
          ),
          sortFn: 'basic',
          meta: {
            label: 'Giới hạn',
            align: 'right',
            cellClassName: 'hidden sm:table-cell',
          },
        }),
        columnHelper.accessor('status', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Trạng thái" />,
          cell: ({ getValue }) => (
            <Badge className="gap-1 bg-blue-100 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300">
              <CheckCircle2 className="h-3 w-3" aria-hidden />
              {getValue()}
            </Badge>
          ),
          sortFn: 'text',
          meta: { label: 'Trạng thái', align: 'center' },
        }),
      ]),
    [],
  )

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          Chiến dịch khuyến mãi đang chạy
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <DataTable
          columns={columns}
          data={campaigns}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          rowNoun="chiến dịch"
          hidePagination
          emptyTitle="Chưa có chiến dịch khuyến mãi"
          emptyDescription="Các chương trình giảm giá đang chạy sẽ hiển thị tại đây."
          emptyIcon={<Sparkles className="h-5 w-5" aria-hidden />}
        />
      </CardContent>
    </Card>
  )
}
