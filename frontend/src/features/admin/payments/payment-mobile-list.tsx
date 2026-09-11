'use client'

/**
 * Mobile card list for the admin payments panel (rendered below md,
 * replacing the DataTable).
 *
 * Extracted from the original 'src/features/admin/payments/payments-panel.tsx'.
 */

import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/currency'
import type { Currency } from '@/lib/currency'
import type { AdminPaymentOut } from '@/lib/queries/payments'
import { ProviderBadge, StatusBadge } from './payment-badges'
import type { PaymentAction, UpdatePaymentStatusMutation } from './types'

export function PaymentMobileList({
  items,
  currency,
  updateStatus,
  setActionDialog,
  setActionAmount,
  setSelectedPayment,
}: {
  items: AdminPaymentOut[]
  currency: Currency
  updateStatus: UpdatePaymentStatusMutation
  setActionDialog: React.Dispatch<React.SetStateAction<PaymentAction | null>>
  setActionAmount: React.Dispatch<React.SetStateAction<string>>
  setSelectedPayment: (p: AdminPaymentOut | null) => void
}) {
  return (
              <div className="divide-y divide-border/50">
                {items.map((p) => (
                  <div
                    key={p.id}
                    className="p-4 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setSelectedPayment(p)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono font-semibold text-xs">
                        {p.bookingCode ?? p.bookingId.slice(0, 8)}
                      </span>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="flex items-center justify-between">
                      <ProviderBadge provider={p.provider} />
                      <span className="font-bold tabular-nums text-sm">
                        {formatCurrency(p.amount, currency)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1.5">
                      {new Date(p.createdAt).toLocaleString('vi-VN', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    {(p.status === 'pending' || p.status === 'completed') && (
                      <div className="flex items-center gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                        {p.status === 'pending' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs text-rose-600 border-rose-200 hover:bg-rose-50"
                            disabled={updateStatus.isPending}
                            onClick={() => setActionDialog({ type: 'cancel', payment: p })}
                          >
                            Huỷ
                          </Button>
                        )}
                        {p.status === 'pending' && p.provider === 'cod' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                            disabled={updateStatus.isPending}
                            onClick={() => {
                              setActionDialog({ type: 'mark_collected', payment: p })
                              setActionAmount(String(p.amount))
                            }}
                          >
                            Đã thu tiền
                          </Button>
                        )}
                        {p.status === 'completed' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs text-blue-600 border-blue-200 hover:bg-blue-50"
                            disabled={updateStatus.isPending}
                            onClick={() => setActionDialog({ type: 'refund', payment: p })}
                          >
                            Hoàn tiền
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
  )
}
