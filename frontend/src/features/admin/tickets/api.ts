import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { endOfMonth, format, startOfMonth, subDays, subMonths } from 'date-fns'
import { toast } from 'sonner'
import { adminBookingsExport, adminBookingsListOptions, adminBookingsStatsOptions } from '@/api'
import { downloadCSV } from '@/features/admin/dashboard/helpers'
import { getErrorMessage } from '@/lib/error-message'
import { useT } from '@/lib/i18n'

export type AdminBookingFilter = {
  brandId?: string
  routeId?: string
  status?: string
  dateFrom?: string
  dateTo?: string
  range?: string
  search?: string
  limit?: number | null
  offset?: number | null
  sort?: string
}

const day = (d: Date) => format(d, 'yyyy-MM-dd')

/** The booking days (`dateFrom..=dateTo`) a range preset covers; `custom` keeps its own. */
export function rangeDays(
  f: Pick<AdminBookingFilter, 'range' | 'dateFrom' | 'dateTo'>,
  today = new Date(),
): { dateFrom?: string; dateTo?: string } {
  const back = (n: number) => ({ dateFrom: day(subDays(today, n - 1)), dateTo: day(today) })
  switch (f.range) {
    case 'today':
      return back(1)
    case '7d':
      return back(7)
    case '30d':
      return back(30)
    case '90d':
      return back(90)
    case 'this_month':
      return { dateFrom: day(startOfMonth(today)), dateTo: day(today) }
    case 'last_month': {
      const last = subMonths(today, 1)
      return { dateFrom: day(startOfMonth(last)), dateTo: day(endOfMonth(last)) }
    }
    default:
      return { dateFrom: f.dateFrom, dateTo: f.dateTo }
  }
}

/** Which bookings `f` selects (`status: 'all'` means unfiltered), without paging. */
const filterQuery = (f: AdminBookingFilter) => ({
  brandId: f.brandId,
  routeId: f.routeId,
  status: f.status && f.status !== 'all' ? f.status : undefined,
  ...rangeDays(f),
  search: f.search,
  sort: f.sort,
})

/** One page of the selection; paging defaults to the first 50. */
const toQuery = (f: AdminBookingFilter) => ({
  ...filterQuery(f),
  limit: f.limit ?? 50,
  offset: f.offset ?? 0,
})

/** Admin bookings; `live` re-polls every 30 s (queues staff watch). */
export function useAdminBookings(filter: AdminBookingFilter, { live = false } = {}) {
  return useQuery({
    ...adminBookingsListOptions({ query: toQuery(filter) }),
    placeholderData: keepPreviousData,
    refetchInterval: live ? 30_000 : false,
    refetchOnWindowFocus: live,
    retry: 1,
  })
}

/** Totals over the whole selection — the same whichever page is shown. */
export function useAdminBookingStats(filter: AdminBookingFilter) {
  return useQuery(adminBookingsStatsOptions({ query: filterQuery(filter) }))
}

/** Downloads the bookings `filter` selects (all of them by default) as CSV and toasts the outcome. */
export function useBookingsCsvExport(filter: AdminBookingFilter = {}) {
  const t = useT()
  const { mutateAsync, isPending } = useMutation({
    mutationFn: async () =>
      (await adminBookingsExport({ query: filterQuery(filter), throwOnError: true })).data,
  })

  const exportCsv = async () => {
    try {
      const { csv, filename, count } = await mutateAsync()
      downloadCSV(filename, csv)
      toast.success(t('adminDash.exportCsvSuccess'), {
        description: t('adminDash.exportCsvSuccessDesc', { count, file: filename }),
      })
    } catch (e) {
      toast.error(t('adminDash.exportCsvFailed'), {
        description: getErrorMessage(e, t('adminDash.pleaseRetry')),
      })
    }
  }
  return { exportCsv, isPending }
}
