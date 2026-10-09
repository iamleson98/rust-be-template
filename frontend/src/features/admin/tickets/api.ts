import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
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

/** `status: 'all'` means unfiltered; paging defaults to the first 50. */
const toQuery = (f: AdminBookingFilter) => ({
  brandId: f.brandId,
  routeId: f.routeId,
  status: f.status && f.status !== 'all' ? f.status : undefined,
  dateFrom: f.dateFrom,
  dateTo: f.dateTo,
  search: f.search,
  limit: f.limit ?? 50,
  offset: f.offset ?? 0,
  sort: f.sort,
})

export function useAdminBookings(filter: AdminBookingFilter) {
  return useQuery({
    ...adminBookingsListOptions({ query: toQuery(filter) }),
    placeholderData: keepPreviousData,
    retry: 1,
  })
}

export function useAdminBookingStats(filter: AdminBookingFilter) {
  return useQuery(adminBookingsStatsOptions({ query: toQuery(filter) }))
}

/** Downloads every booking as CSV and toasts the outcome. */
export function useBookingsCsvExport() {
  const t = useT()
  const { mutateAsync, isPending } = useMutation({
    mutationFn: async () => (await adminBookingsExport({ throwOnError: true })).data,
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
