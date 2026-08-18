'use client'

/**
 * AdminPaymentsPanel — the "Thanh toán" admin tab.
 *
 * Lists all payment rows with status + provider filters + pagination.
 * Each row shows: booking code, provider, amount, status, created_at,
 * and (for COD) a "Mark collected" button.
 *
 * Admin actions:
 *   - For pending payments: cancel (returns row to "no active payment" state).
 *   - For completed payments: mark refunded (separate flow).
 *   - For pending COD: mark collected (driver / agent confirms cash received).
 *
 * The page uses the manually-written TanStack Query hooks in
 * `@/lib/queries/payments`, which wrap the payment SDK in
 * `@/lib/api/payments`.
 */

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import {
  CreditCard,
  Filter,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Ban,
  DollarSign,
  Banknote,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import { useApp } from '@/lib/store'
import {
  useAdminPayments,
  useUpdatePaymentStatus,
} from '@/lib/queries/payments'
import type {
  AdminPaymentOut,
  PaymentProvider,
  PaymentStatus,
} from '@/lib/api/payments'

const PAGE_SIZE = 20

const PROVIDER_OPTIONS: { value: string; label: string; icon: string }[] = [
  { value: 'all', label: 'Tất cả phương thức', icon: '💳' },
  { value: 'vnpay', label: 'VNPay', icon: '🔵' },
  { value: 'momo', label: 'MoMo', icon: '🟣' },
  { value: 'zalopay', label: 'ZaloPay', icon: '🟢' },
  { value: 'vietqr', label: 'VietQR', icon: '🏦' },
  { value: 'cod', label: 'Tiền mặt', icon: '💵' },
]

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'pending', label: 'Đang chờ' },
  { value: 'completed', label: 'Hoàn tất' },
  { value: 'failed', label: 'Thất bại' },
  { value: 'cancelled', label: 'Đã huỷ' },
  { value: 'refunded', label: 'Đã hoàn tiền' },
]

export function AdminPaymentsPanel() {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [providerFilter, setProviderFilter] = useState<string>('all')
  const [page, setPage] = useState(0)
  const [selectedPayment, setSelectedPayment] = useState<AdminPaymentOut | null>(null)
  const [actionDialog, setActionDialog] = useState<{
    type: 'cancel' | 'refund' | 'mark_collected'
    payment: AdminPaymentOut
  } | null>(null)
  const [actionReason, setActionReason] = useState('')
  const [actionAmount, setActionAmount] = useState('')
  const { currency } = useApp()

  const query = useMemo(
    () => ({
      status: statusFilter === 'all' ? undefined : (statusFilter as PaymentStatus),
      provider: providerFilter === 'all' ? undefined : (providerFilter as PaymentProvider),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [statusFilter, providerFilter, page],
  )

  const { data, isLoading, isError, refetch, isFetching } = useAdminPayments(query)
  const updateStatus = useUpdatePaymentStatus()

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const handleSubmitAction = async () => {
    if (!actionDialog) return
    const { type, payment } = actionDialog
    try {
      if (type === 'cancel') {
        await updateStatus.mutateAsync({
          id: payment.id,
          body: { status: 'cancelled', reason: actionReason || undefined },
        } as unknown as { id: string; body: { status: PaymentStatus; reason?: string } })
        toast.success('Đã huỷ giao dịch')
      } else if (type === 'refund') {
        await updateStatus.mutateAsync({
          id: payment.id,
          body: { status: 'refunded', reason: actionReason || undefined },
        } as unknown as { id: string; body: { status: PaymentStatus; reason?: string } })
        toast.success('Đã đánh dấu hoàn tiền')
      } else if (type === 'mark_collected') {
        // For COD mark-collected, use the dedicated endpoint via a mutation
        // (we don't have it as a TanStack hook yet — fall back to fetch).
        const amount = actionAmount ? parseInt(actionAmount, 10) : payment.amount
        const res = await fetch(
          `/api/payments/${encodeURIComponent(payment.id)}/mark-cod-collected`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amountCollected: amount }),
          },
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        toast.success('Đã xác nhận thu tiền mặt')
      }
      setActionDialog(null)
      setActionReason('')
      setActionAmount('')
      refetch()
    } catch (e: unknown) {
      toast.error('Thao tác thất bại', {
        description: e instanceof Error ? e.message : undefined,
      })
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <CreditCard className="h-3.5 w-3.5" />
            Thanh toán
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">Quản lý giao dịch</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Làm mới
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            Lọc:
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0) }}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="Trạng thái" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={providerFilter} onValueChange={(v) => { setProviderFilter(v); setPage(0) }}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="Phương thức" />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  <span className="mr-1.5">{o.icon}</span>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto text-xs text-muted-foreground">
            {total} giao dịch
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="p-8 text-center">
              <AlertCircle className="h-8 w-8 text-rose-400 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                Không tải được danh sách giao dịch. Thử lại.
              </p>
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Chưa có giao dịch nào khớp với bộ lọc.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Mã vé</th>
                    <th className="text-left px-3 py-2 font-medium">Phương thức</th>
                    <th className="text-left px-3 py-2 font-medium">Trạng thái</th>
                    <th className="text-right px-3 py-2 font-medium">Số tiền</th>
                    <th className="text-left px-3 py-2 font-medium">Tham chiếu</th>
                    <th className="text-left px-3 py-2 font-medium">Thời gian</th>
                    <th className="text-right px-3 py-2 font-medium">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((p) => (
                    <tr
                      key={p.id}
                      className="hover:bg-slate-50/50 cursor-pointer"
                      onClick={() => setSelectedPayment(p)}
                    >
                      <td className="px-3 py-2 font-mono text-xs">
                        {p.bookingCode ?? p.bookingId.slice(0, 8)}
                      </td>
                      <td className="px-3 py-2">
                        <ProviderBadge provider={p.provider} />
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {formatCurrency(p.amount, currency)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {p.providerTxnRef.slice(0, 16)}
                        {p.providerTxnRef.length > 16 ? '…' : ''}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {new Date(p.createdAt).toLocaleString('vi-VN')}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {p.status === 'pending' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 h-7 text-xs"
                            disabled={updateStatus.isPending}
                            onClick={(e) => {
                              e.stopPropagation()
                              setActionDialog({ type: 'cancel', payment: p })
                            }}
                          >
                            Huỷ
                          </Button>
                        )}
                        {p.status === 'pending' && p.provider === 'cod' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 h-7 text-xs ml-1"
                            disabled={updateStatus.isPending}
                            onClick={(e) => {
                              e.stopPropagation()
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
                            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 h-7 text-xs"
                            disabled={updateStatus.isPending}
                            onClick={(e) => {
                              e.stopPropagation()
                              setActionDialog({ type: 'refund', payment: p })
                            }}
                          >
                            Hoàn tiền
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                Trang {page + 1} / {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!selectedPayment} onOpenChange={(o) => !o && setSelectedPayment(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">Chi tiết giao dịch</DialogTitle>
            <DialogDescription className="text-xs">
              {selectedPayment?.providerTxnRef}
            </DialogDescription>
          </DialogHeader>
          {selectedPayment && (
            <div className="space-y-3 text-sm">
              <DetailRow label="Mã vé" value={selectedPayment.bookingCode ?? '—'} />
              <DetailRow
                label="Phương thức"
                value={<ProviderBadge provider={selectedPayment.provider} />}
              />
              <DetailRow
                label="Trạng thái"
                value={<StatusBadge status={selectedPayment.status} />}
              />
              <DetailRow
                label="Số tiền"
                value={
                  <span className="font-bold text-blue-700">
                    {formatCurrency(selectedPayment.amount, currency)}
                  </span>
                }
              />
              <DetailRow label="Mã GD cổng" value={selectedPayment.providerTransId ?? '—'} />
              <DetailRow label="Nội dung" value={selectedPayment.memo ?? '—'} />
              <DetailRow
                label="Thời gian tạo"
                value={new Date(selectedPayment.createdAt).toLocaleString('vi-VN')}
              />
              <DetailRow
                label="Cập nhật"
                value={new Date(selectedPayment.updatedAt).toLocaleString('vi-VN')}
              />
              {selectedPayment.collectedAt && (
                <DetailRow
                  label="Đã thu lúc"
                  value={new Date(selectedPayment.collectedAt).toLocaleString('vi-VN')}
                />
              )}
              {selectedPayment.failureReason && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs px-3 py-2">
                  Lý do thất bại: {selectedPayment.failureReason}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Action dialog */}
      <Dialog open={!!actionDialog} onOpenChange={(o) => !o && setActionDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {actionDialog?.type === 'cancel' && 'Huỷ giao dịch'}
              {actionDialog?.type === 'refund' && 'Hoàn tiền giao dịch'}
              {actionDialog?.type === 'mark_collected' && 'Xác nhận thu tiền mặt'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Giao dịch: {actionDialog?.payment.providerTxnRef}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {actionDialog?.type === 'mark_collected' && (
              <div>
                <Label className="text-xs">Số tiền thực thu (VND)</Label>
                <Input
                  type="number"
                  value={actionAmount}
                  onChange={(e) => setActionAmount(e.target.value)}
                  className="mt-1"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Mặc định là số tiền của giao dịch.
                </p>
              </div>
            )}
            {(actionDialog?.type === 'cancel' || actionDialog?.type === 'refund') && (
              <div>
                <Label className="text-xs">Lý do (tùy chọn)</Label>
                <Textarea
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  className="mt-1"
                  rows={3}
                  placeholder="VD: Khách yêu cầu huỷ, ngân hàng từ chối..."
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setActionDialog(null)}>
                Đóng
              </Button>
              <Button
                size="sm"
                disabled={updateStatus.isPending}
                onClick={handleSubmitAction}
                className={
                  actionDialog?.type === 'cancel'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : actionDialog?.type === 'mark_collected'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }
              >
                {updateStatus.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Xác nhận
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────

function DetailRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between border-b pb-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}

function ProviderBadge({ provider }: { provider: PaymentProvider }) {
  const meta: Record<
    PaymentProvider,
    { label: string; cls: string; icon: React.ReactNode }
  > = {
    vnpay: {
      label: 'VNPay',
      cls: 'bg-blue-100 text-blue-800',
      icon: <DollarSign className="h-3 w-3" />,
    },
    momo: {
      label: 'MoMo',
      cls: 'bg-fuchsia-100 text-fuchsia-800',
      icon: <DollarSign className="h-3 w-3" />,
    },
    zalopay: {
      label: 'ZaloPay',
      cls: 'bg-emerald-100 text-emerald-800',
      icon: <DollarSign className="h-3 w-3" />,
    },
    vietqr: {
      label: 'VietQR',
      cls: 'bg-amber-100 text-amber-800',
      icon: <Banknote className="h-3 w-3" />,
    },
    cod: {
      label: 'Tiền mặt',
      cls: 'bg-amber-100 text-amber-800',
      icon: <Banknote className="h-3 w-3" />,
    },
  }
  const m = meta[provider] ?? meta.cod
  return (
    <Badge variant="outline" className={`gap-1 text-[11px] ${m.cls}`}>
      {m.icon}
      {m.label}
    </Badge>
  )
}

function StatusBadge({ status }: { status: PaymentStatus }) {
  const map: Record<PaymentStatus, { label: string; cls: string; icon: React.ReactNode }> = {
    pending: {
      label: 'Đang chờ',
      cls: 'bg-amber-100 text-amber-800',
      icon: <Clock className="h-3 w-3" />,
    },
    completed: {
      label: 'Hoàn tất',
      cls: 'bg-emerald-100 text-emerald-800',
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    failed: {
      label: 'Thất bại',
      cls: 'bg-rose-100 text-rose-800',
      icon: <XCircle className="h-3 w-3" />,
    },
    cancelled: {
      label: 'Đã huỷ',
      cls: 'bg-slate-100 text-slate-700',
      icon: <Ban className="h-3 w-3" />,
    },
    refunded: {
      label: 'Đã hoàn tiền',
      cls: 'bg-blue-100 text-blue-800',
      icon: <RefreshCw className="h-3 w-3" />,
    },
  }
  const m = map[status] ?? map.pending
  return (
    <Badge variant="outline" className={`gap-1 text-[11px] ${m.cls}`}>
      {m.icon}
      {m.label}
    </Badge>
  )
}
