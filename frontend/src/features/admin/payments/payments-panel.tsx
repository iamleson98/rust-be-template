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
import { DataTable, DataTableViewOptions } from '@/components/data-table'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ComboboxField } from '@/components/ui/combobox'
import { toast } from 'sonner'
import { AdminStatsCardsSkeleton } from '@/features/admin/dashboard/stats-cards-skeleton'
import {
  CreditCard,
  Filter,
  RefreshCw,
  CheckCircle2,
  Clock,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import { useT } from '@/lib/i18n'
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
import { KpiCard } from './payment-kpi-card'
import { PROVIDER_OPTIONS } from './payment-badges'
import { usePaymentColumns } from './payment-columns'
import { PaymentMobileList } from './payment-mobile-list'
import { PaymentDetailDialog } from './payment-detail-dialog'
import { PaymentActionDialog } from './payment-action-dialog'
import type { PaymentAction } from './types'


/** Stable empty default — keeps useMemo deps referentially stable when data is not loaded yet. */
const EMPTY_ITEMS: never[] = []
const PAGE_SIZE = 15

const STATUS_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'all', labelKey: 'adminPayments.statusAll' },
  { value: 'pending', labelKey: 'admin.stats.openCount' },
  { value: 'completed', labelKey: 'booking.complete' },
  { value: 'failed', labelKey: 'adminPayments.statusFailed' },
  { value: 'cancelled', labelKey: 'adminPayments.statusCancelled' },
  { value: 'refunded', labelKey: 'adminPayments.statusRefunded' },
]

export function AdminPaymentsPanel() {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [providerFilter, setProviderFilter] = useState<string>('all')
  const [page, setPage] = useState(0)
  const [selectedPayment, setSelectedPayment] = useState<AdminPaymentOut | null>(null)
  const [actionDialog, setActionDialog] = useState<PaymentAction | null>(null)
  const [actionReason, setActionReason] = useState('')
  const [actionAmount, setActionAmount] = useState('')
  const { currency } = useApp()
  const t = useT()

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

  const items = data?.items ?? EMPTY_ITEMS
  const total = data?.total ?? 0

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

  const columns = usePaymentColumns({ currency, updateStatus, setActionDialog, setActionAmount })

  const handleSubmitAction = async () => {
    if (!actionDialog) return
    const { type, payment } = actionDialog
    try {
      if (type === 'cancel') {
        await updateStatus.mutateAsync({
          id: payment.id,
          body: { status: 'cancelled', reason: actionReason || undefined },
        } as unknown as { id: string; body: { status: PaymentStatus; reason?: string } })
        toast.success(t('adminPayments.cancelledToast'))
      } else if (type === 'refund') {
        await updateStatus.mutateAsync({
          id: payment.id,
          body: { status: 'refunded', reason: actionReason || undefined },
        } as unknown as { id: string; body: { status: PaymentStatus; reason?: string } })
        toast.success(t('adminPayments.refundedToast'))
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
        toast.success(t('adminPayments.collectedToast'))
      }
      setActionDialog(null)
      setActionReason('')
      setActionAmount('')
      refetch()
    } catch (e: unknown) {
      toast.error(t('adminPayments.actionFailed'), {
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
            {t('admin.payments')}
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">{t('adminPayments.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('adminPayments.subtitle')}
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
          {t('common.refresh')}
        </Button>
      </div>

      {/* ── KPI cards — skeleton while the first page loads (never zero-value cards) ── */}
      {isLoading ? (
        <AdminStatsCardsSkeleton count={4} />
      ) : (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label={t('adminPayments.kpiTotal')}
          value={kpis.totalCount.toString()}
          color="text-blue-600 bg-blue-50 dark:bg-blue-950/30"
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label={t('adminPayments.kpiCompleted')}
          value={kpis.completedCount.toString()}
          color="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
        />
        <KpiCard
          icon={<Clock className="h-4 w-4" />}
          label={t('admin.stats.openCount')}
          value={kpis.pendingCount.toString()}
          color="text-amber-600 bg-amber-50 dark:bg-amber-950/30"
        />
        <KpiCard
          icon={<Wallet className="h-4 w-4" />}
          label={t('adminPayments.kpiRevenue')}
          value={formatCurrency(kpis.revenue, currency)}
          color="text-violet-600 bg-violet-50 dark:bg-violet-950/30"
        />
      </div>
      )}

      {/* ── Filter bar ─────────────────────────────────────── */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            {t('adminPayments.filterLabel')}
          </div>
          <ComboboxField
            value={statusFilter}
            onValueChange={(v) => { setStatusFilter(v); setPage(0) }}
            items={STATUS_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            className="w-45 h-8 text-xs"
            placeholder={t('common.status')}
            searchPlaceholder={t('combobox.search')}
            aria-label={t('adminPayments.filterByStatus')}
            data-testid="payment-status-filter"
          />
          <ComboboxField
            value={providerFilter}
            onValueChange={(v) => { setProviderFilter(v); setPage(0) }}
            items={PROVIDER_OPTIONS.map((o) => ({ value: o.value, label: o.labelKey ? t(o.labelKey) : (o.label ?? o.value) }))}
            className="w-40 h-8 text-xs"
            placeholder={t('adminPayments.method')}
            searchPlaceholder={t('combobox.search')}
            aria-label={t('adminPayments.filterByMethod')}
            data-testid="payment-provider-filter"
          />
          <div className="ml-auto text-xs text-muted-foreground font-medium">
            {t('adminPayments.transactionCount', { count: total })}
          </div>
        </CardContent>
      </Card>

      {/* ── Table / Cards — the DataTable renders its own bordered surface. ─── */}
      <DataTable
            columns={columns}
            data={items}
            rowNoun={t('adminPayments.rowNoun')}
            manualPagination
            totalRowCount={total}
            pageIndex={page}
            onPageIndexChange={setPage}
            pageSize={PAGE_SIZE}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => refetch()}
            onRowClick={(p) => setSelectedPayment(p)}
            rowAriaLabel={(p) => t('adminPayments.rowAriaLabel', { code: p.bookingCode ?? p.bookingId.slice(0, 8) })}
            emptyTitle={t('adminPayments.emptyTitle')}
            emptyDescription={
              statusFilter !== 'all' || providerFilter !== 'all'
                ? t('adminPayments.emptyFiltered')
                : t('adminPayments.emptyDescription')
            }
            emptyIcon={<CreditCard className="h-5 w-5" aria-hidden />}
            toolbar={(table) => (
              <div className="flex items-center justify-end border-b bg-muted/20 px-4 py-2">
                <DataTableViewOptions table={table} className="ml-auto h-8" />
              </div>
            )}
            mobileList={
              <PaymentMobileList
                items={items}
                currency={currency}
                updateStatus={updateStatus}
                setActionDialog={setActionDialog}
                setActionAmount={setActionAmount}
                setSelectedPayment={setSelectedPayment}
              />
            }
          />

      {/* ── Detail dialog ──────────────────────────────────── */}
      <PaymentDetailDialog
        selectedPayment={selectedPayment}
        setSelectedPayment={setSelectedPayment}
        updateStatus={updateStatus}
        setActionDialog={setActionDialog}
        setActionAmount={setActionAmount}
        currency={currency}
      />

      {/* ── Action dialog ──────────────────────────────────── */}
      <PaymentActionDialog
        actionDialog={actionDialog}
        setActionDialog={setActionDialog}
        actionReason={actionReason}
        setActionReason={setActionReason}
        actionAmount={actionAmount}
        setActionAmount={setActionAmount}
        updateStatus={updateStatus}
        handleSubmitAction={handleSubmitAction}
      />
    </div>
  )
}
