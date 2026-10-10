'use client'

/**
 * AdminPaymentsPanel — redesigned "Thanh toán" admin page.
 *
 * Features:
 *   - Totals over every payment (`GET /api/admin/payments/summary`)
 *   - Filter bar with status + provider dropdowns
 *   - Responsive table → card list on mobile
 *   - Detail dialog with full payment info
 *   - Admin actions: cancel, refund, mark COD collected
 *   - Provider + status badges with semantic colors
 */

import {
  adminPaymentSummaryOptions,
  markCodCollectedMutation,
  updatePaymentStatusMutation,
  listAdminPaymentsOptions,
} from '@/api'
import { useMutation, useQuery, keepPreviousData } from '@tanstack/react-query'
import { usePrefs } from '@/stores/prefs'
import { useMemo, useState } from 'react'
import { DataTable, DataTableViewOptions } from '@/components/data-table'
import { ConsolePage, PageHeader } from '@/components/console/page'
import { StatGrid, StatTile } from '@/components/console/stat-tile'
import { Button } from '@/components/ui/button'
import { ComboboxField } from '@/components/ui/combobox'
import { toast } from 'sonner'
import { AdminStatsCardsSkeleton } from '@/features/admin/dashboard/stats-cards-skeleton'
import { CheckCircle2, Clock, CreditCard, RefreshCw, TrendingUp, Wallet } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { useT } from '@/lib/i18n'
import type { AdminPaymentOut } from '@/api'
import type { PaymentProvider, PaymentStatus } from '@/lib/payment'
import { PROVIDER_OPTIONS } from './payment-badges'
import { usePaymentColumns } from './payment-columns'
import { PaymentMobileList } from './payment-mobile-list'
import { PaymentDetailDialog } from './payment-detail-dialog'
import { PaymentActionDialog } from './payment-action-dialog'
import type { PaymentAction } from './types'

/** Stable empty default while the first page loads. */
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
  const currency = usePrefs((s) => s.currency)
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

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    ...listAdminPaymentsOptions({ query }),
    placeholderData: keepPreviousData,
  })
  const summary = useQuery(adminPaymentSummaryOptions())
  const updateStatus = useMutation(updatePaymentStatusMutation())
  // Goes through the shared SDK client (cookie auth + token refresh +
  // error parsing) — the previous raw `fetch` bypassed all of it, so an
  // expired access token surfaced as a bare "HTTP 401" toast.
  const markCollected = useMutation(markCodCollectedMutation())

  const items = data?.items ?? EMPTY_ITEMS
  const total = data?.total ?? 0

  const columns = usePaymentColumns({ currency, updateStatus, setActionDialog, setActionAmount })

  const handleSubmitAction = async () => {
    if (!actionDialog) return
    const { type, payment } = actionDialog
    try {
      if (type === 'cancel') {
        await updateStatus.mutateAsync({
          path: { id: payment.id },
          body: { status: 'cancelled', reason: actionReason || undefined },
        })
        toast.success(t('adminPayments.cancelledToast'))
      } else if (type === 'refund') {
        await updateStatus.mutateAsync({
          path: { id: payment.id },
          body: { status: 'refunded', reason: actionReason || undefined },
        })
        toast.success(t('adminPayments.refundedToast'))
      } else if (type === 'mark_collected') {
        const amount = actionAmount ? parseInt(actionAmount, 10) : payment.amount
        await markCollected.mutateAsync({
          path: { id: payment.id },
          body: { amountCollected: amount },
        })
        toast.success(t('adminPayments.collectedToast'))
      }
      setActionDialog(null)
      setActionReason('')
      setActionAmount('')
      void refetch()
      void summary.refetch()
    } catch (e: unknown) {
      toast.error(t('adminPayments.actionFailed'), {
        description: e instanceof Error ? e.message : undefined,
      })
    }
  }

  return (
    <ConsolePage>
      <PageHeader
        title={t('adminPayments.title')}
        description={t('adminPayments.subtitle')}
        actions={
          <Button
            variant="outline"
            onClick={() => {
              void refetch()
              void summary.refetch()
            }}
            disabled={isFetching}
          >
            <RefreshCw className={isFetching ? 'animate-spin' : undefined} />
            {t('common.refresh')}
          </Button>
        }
      />

      {/* Totals over every payment, from the server — never just this page. */}
      {summary.isLoading ? (
        <AdminStatsCardsSkeleton count={4} />
      ) : summary.data ? (
        <StatGrid>
          <StatTile
            icon={<TrendingUp />}
            label={t('adminPayments.kpiTotal')}
            value={summary.data.total.toLocaleString('vi-VN')}
          />
          <StatTile
            icon={<CheckCircle2 />}
            tone="green"
            label={t('adminPayments.kpiCompleted')}
            value={summary.data.completed.toLocaleString('vi-VN')}
          />
          <StatTile
            icon={<Clock />}
            tone="amber"
            label={t('admin.stats.openCount')}
            value={summary.data.pending.toLocaleString('vi-VN')}
          />
          <StatTile
            icon={<Wallet />}
            tone="violet"
            label={t('adminPayments.kpiCollected')}
            value={formatCurrency(summary.data.collected, currency)}
            hint={t('adminPayments.kpiCollectedHint')}
          />
        </StatGrid>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <ComboboxField
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v)
            setPage(0)
          }}
          items={STATUS_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          className="min-w-0 flex-1 sm:w-48 sm:flex-none"
          placeholder={t('common.status')}
          searchPlaceholder={t('combobox.search')}
          aria-label={t('adminPayments.filterByStatus')}
          data-testid="payment-status-filter"
        />
        <ComboboxField
          value={providerFilter}
          onValueChange={(v) => {
            setProviderFilter(v)
            setPage(0)
          }}
          items={PROVIDER_OPTIONS.map((o) => ({
            value: o.value,
            label: o.labelKey ? t(o.labelKey) : (o.label ?? o.value),
          }))}
          className="min-w-0 flex-1 sm:w-44 sm:flex-none"
          placeholder={t('adminPayments.method')}
          searchPlaceholder={t('combobox.search')}
          aria-label={t('adminPayments.filterByMethod')}
          data-testid="payment-provider-filter"
        />
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
          {t('adminPayments.transactionCount', { count: total })}
        </span>
      </div>

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
        rowAriaLabel={(p) =>
          t('adminPayments.rowAriaLabel', { code: p.bookingCode ?? p.bookingId.slice(0, 8) })
        }
        emptyTitle={t('adminPayments.emptyTitle')}
        emptyDescription={
          statusFilter !== 'all' || providerFilter !== 'all'
            ? t('adminPayments.emptyFiltered')
            : t('adminPayments.emptyDescription')
        }
        emptyIcon={<CreditCard className="h-5 w-5" aria-hidden />}
        toolbar={(table) => (
          <div className="hidden items-center justify-end border-b bg-muted/20 px-4 py-2 md:flex">
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
    </ConsolePage>
  )
}
