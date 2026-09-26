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
import { useT } from '@/lib/i18n'
import { formatNum } from '@/lib/types'
import { useCampaigns } from '@/lib/queries'
import type { AdminCampaignRow as Campaign } from './types'

const columnHelper = createColumnHelper<DataTableFeatures, Campaign>()

export function CampaignsPanel() {
  const t = useT()
  const { data, isLoading, isError, refetch } = useCampaigns()
  const campaigns: Campaign[] = (data?.items ?? []) as unknown as Campaign[]

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('code', {
          header: ({ column }) => <DataTableColumnHeader column={column} title={t('adminDash.code')} />,
          cell: ({ getValue }) => (
            <code className="font-mono font-bold text-blue-700 dark:text-blue-400">{getValue()}</code>
          ),
          sortFn: 'text',
          meta: { label: t('adminDash.code') },
        }),
        columnHelper.accessor('name', {
          header: ({ column }) => <DataTableColumnHeader column={column} title={t('common.name')} />,
          cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
          sortFn: 'text',
          meta: { label: t('common.name') },
        }),
        columnHelper.accessor((row) => row.brand?.name ?? t('adminDash.platformWide'), {
          id: 'brand',
          header: ({ column }) => <DataTableColumnHeader column={column} title={t('adminDash.brand')} />,
          sortFn: 'text',
          meta: { label: t('adminDash.brand'), cellClassName: 'hidden md:table-cell' },
        }),
        columnHelper.accessor('usedCount', {
          header: ({ column }) => <DataTableColumnHeader column={column} title={t('adminDash.usedCount')} />,
          cell: ({ getValue }) => (
            <span className="font-medium tabular-nums">{formatNum(getValue())}</span>
          ),
          sortFn: 'basic',
          meta: { label: t('adminDash.usedCount'), align: 'right' },
        }),
        columnHelper.accessor('usageLimitTotal', {
          header: ({ column }) => <DataTableColumnHeader column={column} title={t('adminDash.usageLimit')} />,
          cell: ({ getValue }) => (
            <span className="tabular-nums text-muted-foreground">
              {getValue() > 0 ? formatNum(getValue()) : '∞'}
            </span>
          ),
          sortFn: 'basic',
          meta: {
            label: t('adminDash.usageLimit'),
            align: 'right',
            cellClassName: 'hidden sm:table-cell',
          },
        }),
        columnHelper.accessor('status', {
          header: ({ column }) => <DataTableColumnHeader column={column} title={t('common.status')} />,
          cell: ({ getValue }) => (
            <Badge className="gap-1 bg-blue-100 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300">
              <CheckCircle2 className="h-3 w-3" aria-hidden />
              {getValue()}
            </Badge>
          ),
          sortFn: 'text',
          meta: { label: t('common.status'), align: 'center' },
        }),
      ]),
    [t],
  )

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          {t('adminDash.campaignsTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {/* The Card provides the surface — render the table unbordered. */}
        <DataTable
          bordered={false}
          columns={columns}
          data={campaigns}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          rowNoun={t('adminDash.campaignNoun')}
          hidePagination
          emptyTitle={t('adminDash.noCampaignsTitle')}
          emptyDescription={t('adminDash.noCampaignsDesc')}
          emptyIcon={<Sparkles className="h-5 w-5" aria-hidden />}
        />
      </CardContent>
    </Card>
  )
}
