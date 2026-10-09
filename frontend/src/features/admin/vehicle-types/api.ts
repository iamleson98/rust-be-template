import { adminVehicleTypesList, type AdminVehicleTypeOut } from '@/api'
import { toInfinitePage, type InfiniteFetchPage } from '@/components/ui/infinite-select'

const PAGE_SIZE = 25

/** One page of vehicle types for `InfiniteSelect`. */
export const fetchVehicleTypesPage: InfiniteFetchPage<AdminVehicleTypeOut> = async (
  page,
  search,
  signal,
) => {
  const offset = page * PAGE_SIZE
  const { data } = await adminVehicleTypesList({
    query: { q: search.trim() || undefined, limit: PAGE_SIZE, offset },
    signal,
  })
  return toInfinitePage(data, offset)
}
