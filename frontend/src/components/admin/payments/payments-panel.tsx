'use client'

/**
 * AdminPaymentsPanel — redesigned "Thanh toán" admin page.
 *
 * Features:
 *   - KPI summary cards (total revenue, pending count, completed count)
 *   - Filter bar with status + provider dropdowns
 *   - Responsive table → card list on mobile
 *   - Detail dialog with full payment info
 *   - Admin actions: cancel, refund, mark COD collected
 *   - Provider + status badges with semantic colors
 */

import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Input } from '@/components/ui/input'
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
  Loader2,
  AlertCircle,
  TrendingUp,
  Wallet,
  Banknote,
  ArrowLeftRight,
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
} from '@/lib/queries/payments'

const PAGE_SIZE = 15

const PROVIDER_OPTIONS: { value: string; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'all', label: 'Tất cả', icon: <Filter className="h-3.5 w-3.5" />, color: 'text-muted-foreground' },
  { value: 'vnpay', label: 'VNPay', icon: <span className="text-blue-500 font-bold text-xs">VNP</span>, color: 'text-blue-600' },
  { value: 'momo', label: 'MoMo', icon: <span className="text-fuchsia-500 font-bold text-xs">MM</span>, color: 'text-fuchsia-600' },
  { value: 'zalopay', label: 'ZaloPay', icon: <span className="text-emerald-500 font-bold text-xs">ZLP</span>, color: 'text-emerald-600' },
  { value: 'vietqr', label: 'VietQR', icon: <span className="text-amber-500 font-bold text-xs">QR</span>, color: 'text-amber-600' },
  { value: 'cod', label: 'Tiền mặt', icon: <Banknote className="h-3.5 w-3.5" />, color: 'text-amber-600' },
]

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'pending', label: 'Đang chờ' },
  { value: 'completed', label: 'Hoàn tất' },
  { value: 'failed', label: 'Thất bại' },
  { value: 'cancelled', label: 'Đã huỷ' },
  { value: 'refunded', label: 'Đã hoàn tiền' },
]

function ProviderBadge({ provider }: { provider: PaymentProvider | string }) {
  const meta = PROVIDER_OPTIONS.find((p) => p.value === provider)
  if (!meta) return <Badge variant="outline" className="text-xs">{provider}</Badge>
  return (
    <Badge variant="outline" className={`gap-1.5 text-xs ${meta.color} border-current/20`}>
      {meta.icon}
      {meta.label}
    </Badge>
  )
}

function StatusBadge({ status }: { status: PaymentStatus | string }) {
  const map: Record<PaymentStatus, { label: string; cls: string; icon: React.ReactNode }> = {
    pending: { label: 'Đang chờ', cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900', icon: <Clock className="h-3 w-3" /> },
    completed: { label: 'Hoàn tất', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900', icon: <CheckCircle2 className="h-3 w-3" /> },
    failed: { label: 'Thất bại', cls: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900', icon: <XCircle className="h-3 w-3" /> },
    cancelled: { label: 'Đã huỷ', cls: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900/50 dark:text-slate-400 dark:border-slate-800', icon: <Ban className="h-3 w-3" /> },
    refunded: { label: 'Hoàn tiền', cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900', icon: <ArrowLeftRight className="h-3 w-3" /> },
  }
  const m = map[status as PaymentStatus] ?? map.pending
  return (
    <Badge variant="outline" className={`gap-1 text-xs font-medium ${m.cls}`}>
      {m.icon}
      {m.label}
    </Badge>
  )
}

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

  // Compute KPIs from current page data
  const kpis = useMemo(() => {
    const completed = items.filter((p) => p.status === 'completed')
    const pending = items.filter((p) => p.status === 'pending')
    const revenue = completed.reduce((sum, p) => sum + p.amount, 0)
    return {
      revenue,
      pendingCount: pending.length,
      completedCount: completed.length,
      totalCount: total,
    }
  }, [items, total])

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
    <div className="p-3 space-y-3">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <CreditCard className="h-3.5 w-3.5" />
            Thanh toán
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">Quản lý giao dịch</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Theo dõi và quản lý tất cả giao dịch thanh toán
          </p>
        </div>
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

      {/* ── KPI cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Tổng giao dịch"
          value={kpis.totalCount.toString()}
          color="text-blue-600 bg-blue-50 dark:bg-blue-950/30"
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Đã hoàn tất"
          value={kpis.completedCount.toString()}
          color="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
        />
        <KpiCard
          icon={<Clock className="h-4 w-4" />}
          label="Đang chờ"
          value={kpis.pendingCount.toString()}
          color="text-amber-600 bg-amber-50 dark:bg-amber-950/30"
        />
        <KpiCard
          icon={<Wallet className="h-4 w-4" />}
          label="Doanh thu (trang)"
          value={formatCurrency(kpis.revenue, currency)}
          color="text-violet-600 bg-violet-50 dark:bg-violet-950/30"
        />
      </div>

      {/* ── Filter bar ─────────────────────────────────────── */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            Lọc:
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0) }}>
            <SelectTrigger className="w-45 h-8 text-xs">
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
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue placeholder="Phương thức" />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  <span className="flex items-center gap-1.5">
                    {o.icon}
                    {o.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto text-xs text-muted-foreground font-medium">
            {total} giao dịch
          </div>
        </CardContent>
      </Card>

      {/* ── Table / Cards ─────────────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : isError ? (
            <div className="p-12 text-center">
              <AlertCircle className="h-10 w-10 text-rose-400 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">Không tải được danh sách giao dịch</p>
              <p className="text-xs text-muted-foreground mt-1">Vui lòng thử lại sau.</p>
              <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => refetch()}>
                <RefreshCw className="h-3.5 w-3.5" /> Thử lại
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center">
              <CreditCard className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">Chưa có giao dịch nào</p>
              <p className="text-xs text-muted-foreground mt-1">
                {statusFilter !== 'all' || providerFilter !== 'all'
                  ? 'Thử thay đổi bộ lọc.'
                  : 'Giao dịch sẽ xuất hiện ở đây khi có khách đặt vé.'}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground border-b">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium">Mã vé</th>
                      <th className="text-left px-4 py-2.5 font-medium">Phương thức</th>
                      <th className="text-left px-4 py-2.5 font-medium">Trạng thái</th>
                      <th className="text-right px-4 py-2.5 font-medium">Số tiền</th>
                      <th className="text-left px-4 py-2.5 font-medium">Tham chiếu</th>
                      <th className="text-left px-4 py-2.5 font-medium">Thời gian</th>
                      <th className="text-right px-4 py-2.5 font-medium">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {items.map((p) => (
                      <tr
                        key={p.id}
                        className="hover:bg-muted/30 cursor-pointer transition-colors card-hover-lift"
                        onClick={() => setSelectedPayment(p)}
                      >
                        <td className="px-4 py-3">
                          <span className="font-mono font-semibold text-xs">
                            {p.bookingCode ?? p.bookingId.slice(0, 8)}
                          </span>
                        </td>
                        <td className="px-4 py-3"><ProviderBadge provider={p.provider} /></td>
                        <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums">
                          {formatCurrency(p.amount, currency)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {p.providerTxnRef.slice(0, 14)}
                          {p.providerTxnRef.length > 14 ? '…' : ''}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {new Date(p.createdAt).toLocaleString('vi-VN', {
                            day: '2-digit', month: '2-digit',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-border/50">
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
                        day: '2-digit', month: '2-digit',
                        hour: '2-digit', minute: '2-digit',
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
            </>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs">
              <span className="text-muted-foreground">
                Trang {page + 1} / {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
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

      {/* ── Detail dialog ──────────────────────────────────── */}
      <Dialog open={!!selectedPayment} onOpenChange={(o) => !o && setSelectedPayment(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">Chi tiết giao dịch</DialogTitle>
            <DialogDescription className="text-xs">
              {selectedPayment?.providerTxnRef}
            </DialogDescription>
          </DialogHeader>
          {selectedPayment && (
            <div className="space-y-2.5 text-sm">
              <DetailRow label="Mã vé" value={
                <span className="font-mono font-semibold">{selectedPayment.bookingCode ?? '—'}</span>
              } />
              <DetailRow label="Phương thức" value={<ProviderBadge provider={selectedPayment.provider} />} />
              <DetailRow label="Trạng thái" value={<StatusBadge status={selectedPayment.status} />} />
              <DetailRow
                label="Số tiền"
                value={
                  <span className="font-bold text-primary text-base">
                    {formatCurrency(selectedPayment.amount, currency)}
                  </span>
                }
              />
              <DetailRow label="Mã GD cổng" value={
                <span className="font-mono text-xs text-muted-foreground">
                  {selectedPayment.providerTransId ?? '—'}
                </span>
              } />
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
                <div className="rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-400 text-xs px-3 py-2">
                  Lý do thất bại: {selectedPayment.failureReason}
                </div>
              )}

              {/* Action buttons in detail dialog */}
              <div className="flex items-center gap-2 pt-3 border-t">
                {selectedPayment.status === 'pending' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-rose-600 border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    disabled={updateStatus.isPending}
                    onClick={() => {
                      setActionDialog({ type: 'cancel', payment: selectedPayment })
                      setSelectedPayment(null)
                    }}
                  >
                    <Ban className="h-3.5 w-3.5" /> Huỷ giao dịch
                  </Button>
                )}
                {selectedPayment.status === 'pending' && selectedPayment.provider === 'cod' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                    disabled={updateStatus.isPending}
                    onClick={() => {
                      setActionDialog({ type: 'mark_collected', payment: selectedPayment })
                      setActionAmount(String(selectedPayment.amount))
                      setSelectedPayment(null)
                    }}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Đã thu tiền
                  </Button>
                )}
                {selectedPayment.status === 'completed' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                    disabled={updateStatus.isPending}
                    onClick={() => {
                      setActionDialog({ type: 'refund', payment: selectedPayment })
                      setSelectedPayment(null)
                    }}
                  >
                    <ArrowLeftRight className="h-3.5 w-3.5" /> Hoàn tiền
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Action dialog ──────────────────────────────────── */}
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

// ── Helper components ───────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  color: string
}) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <div className={`flex items-center justify-center h-8 w-8 rounded-lg ${color}`}>
            {icon}
          </div>
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground truncate">{label}</div>
            <div className="text-base font-bold tabular-nums truncate">{value}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DetailRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between border-b pb-2 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  )
}
