'use client'

/**
 * Table columns for the admin payments DataTable.
 *
 * Extracted from the original 'src/features/admin/payments/payments-panel.tsx'.
 */

import { useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { DataTableColumnHeader, type DataTableFeatures } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { formatCurrency } from '@/lib/currency'
import type { Currency } from '@/lib/currency'
import type { AdminPaymentOut } from '@/lib/queries/payments'
import { ProviderBadge, StatusBadge } from './payment-badges'
import type { PaymentAction, UpdatePaymentStatusMutation } from './types'

const paymentColumnHelper = createColumnHelper<DataTableFeatures, AdminPaymentOut>()

export function usePaymentColumns({
  currency,
  updateStatus,
  setActionDialog,
  setActionAmount,
}: {
  currency: Currency
  updateStatus: UpdatePaymentStatusMutation
  setActionDialog: React.Dispatch<React.SetStateAction<PaymentAction | null>>
  setActionAmount: React.Dispatch<React.SetStateAction<string>>
}) {
  const t = useT()
  // Table columns — rebuilt when the currency or mutation-pending state
  // changes; all dialog setters below are stable setState references.
  return useMemo(
    () =>
      paymentColumnHelper.columns([
        paymentColumnHelper.accessor((p) => p.bookingCode ?? p.bookingId.slice(0, 8), {
          id: 'code',
          header: ({ column }) => <DataTableColumnHeader column={column} title={t('booking.code')} />,
          cell: ({ getValue }) => (
            <span className="font-mono text-xs font-semibold">{getValue()}</span>
          ),
          sortFn: 'text',
          meta: { label: t('booking.code') },
        }),
        paymentColumnHelper.accessor('provider', {
          header: ({ column }) => <DataTableColumnHeader column={column} title={t('adminPayments.method')} />,
          cell: ({ getValue }) => <ProviderBadge provider={getValue()} />,
          sortFn: 'text',
          meta: { label: t('adminPayments.method') },
        }),
        paymentColumnHelper.accessor('status', {
          header: ({ column }) => <DataTableColumnHeader column={column} title={t('common.status')} />,
          cell: ({ getValue }) => <StatusBadge status={getValue()} />,
          sortFn: 'text',
          meta: { label: t('common.status') },
        }),
        paymentColumnHelper.accessor('amount', {
          header: ({ column }) => <DataTableColumnHeader column={column} title={t('adminPayments.amount')} />,
          cell: ({ getValue }) => (
            <span className="font-bold tabular-nums">{formatCurrency(getValue(), currency)}</span>
          ),
          sortFn: 'basic',
          meta: { label: t('adminPayments.amount'), align: 'right' },
        }),
        paymentColumnHelper.accessor('providerTxnRef', {
          header: ({ column }) => <DataTableColumnHeader column={column} title={t('adminPayments.reference')} />,
          cell: ({ getValue }) => (
            <span className="font-mono text-xs text-muted-foreground">
              {getValue().slice(0, 14)}
              {getValue().length > 14 ? '…' : ''}
            </span>
          ),
          sortFn: 'text',
          meta: { label: t('adminPayments.reference') },
        }),
        paymentColumnHelper.accessor('createdAt', {
          header: ({ column }) => <DataTableColumnHeader column={column} title={t('adminPayments.time')} />,
          cell: ({ getValue }) => (
            <span className="text-xs tabular-nums text-muted-foreground">
              {new Date(getValue()).toLocaleString('vi-VN', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          ),
          sortFn: 'datetime',
          meta: { label: t('adminPayments.time') },
        }),
        paymentColumnHelper.display({
          id: 'actions',
          header: t('common.actions'),
          cell: ({ row }) => {
            const p = row.original
            return (
              // Keep row-level click-to-open from firing on action buttons.
              <div
                className="flex items-center justify-end gap-1"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {p.status === 'pending' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    disabled={updateStatus.isPending}
                    onClick={() => setActionDialog({ type: 'cancel', payment: p })}
                  >
                    {t('common.cancel')}
                  </Button>
                )}
                {p.status === 'pending' && p.provider === 'cod' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                    disabled={updateStatus.isPending}
                    onClick={() => {
                      setActionDialog({ type: 'mark_collected', payment: p })
                      setActionAmount(String(p.amount))
                    }}
                  >
                    {t('adminPayments.collectedShort')}
                  </Button>
                )}
                {p.status === 'completed' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                    disabled={updateStatus.isPending}
                    onClick={() => setActionDialog({ type: 'refund', payment: p })}
                  >
                    {t('adminPayments.refund')}
                  </Button>
                )}
              </div>
            )
          },
          enableSorting: false,
          enableHiding: false,
          meta: { align: 'right', label: t('common.actions') },
        }),
      ]),
    [currency, updateStatus.isPending, setActionDialog, setActionAmount, t],
  )
}
