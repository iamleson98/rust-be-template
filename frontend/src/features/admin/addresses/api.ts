import { adminAddressesList, type AdminAddressOut } from '@/api'
import { toInfinitePage, type InfiniteFetchPage } from '@/components/ui/infinite-select'

const PAGE_SIZE = 25

/** `InfiniteSelect` page loader for one brand's addresses. */
export const brandAddressesPage =
  (brandId: string): InfiniteFetchPage<AdminAddressOut> =>
  async (page, search, signal) => {
    const offset = page * PAGE_SIZE
    const { data } = await adminAddressesList({
      query: { brandId, q: search.trim() || undefined, limit: PAGE_SIZE, offset },
      signal,
    })
    return toInfinitePage(data, offset)
  }
