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
  // Table columns — rebuilt when the currency or mutation-pending state
  // changes; all dialog setters below are stable setState references.
  return useMemo(
    () =>
      paymentColumnHelper.columns([
        paymentColumnHelper.accessor((p) => p.bookingCode ?? p.bookingId.slice(0, 8), {
          id: 'code',
          header: ({ column }) => <DataTableColumnHeader column={column} title="Mã vé" />,
          cell: ({ getValue }) => (
            <span className="font-mono text-xs font-semibold">{getValue()}</span>
          ),
          sortFn: 'text',
          meta: { label: 'Mã vé' },
        }),
        paymentColumnHelper.accessor('provider', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Phương thức" />,
          cell: ({ getValue }) => <ProviderBadge provider={getValue()} />,
          sortFn: 'text',
          meta: { label: 'Phương thức' },
        }),
        paymentColumnHelper.accessor('status', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Trạng thái" />,
          cell: ({ getValue }) => <StatusBadge status={getValue()} />,
          sortFn: 'text',
          meta: { label: 'Trạng thái' },
        }),
        paymentColumnHelper.accessor('amount', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Số tiền" />,
          cell: ({ getValue }) => (
            <span className="font-bold tabular-nums">{formatCurrency(getValue(), currency)}</span>
          ),
          sortFn: 'basic',
          meta: { label: 'Số tiền', align: 'right' },
        }),
        paymentColumnHelper.accessor('providerTxnRef', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Tham chiếu" />,
          cell: ({ getValue }) => (
            <span className="font-mono text-xs text-muted-foreground">
              {getValue().slice(0, 14)}
              {getValue().length > 14 ? '…' : ''}
            </span>
          ),
          sortFn: 'text',
          meta: { label: 'Tham chiếu' },
        }),
        paymentColumnHelper.accessor('createdAt', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Thời gian" />,
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
          meta: { label: 'Thời gian' },
        }),
        paymentColumnHelper.display({
          id: 'actions',
          header: 'Thao tác',
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
                    Huỷ
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
                    Đã thu
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
                    Hoàn tiền
                  </Button>
                )}
              </div>
            )
          },
          enableSorting: false,
          enableHiding: false,
          meta: { align: 'right', label: 'Thao tác' },
        }),
      ]),
    [currency, updateStatus.isPending, setActionDialog, setActionAmount],
  )
}
