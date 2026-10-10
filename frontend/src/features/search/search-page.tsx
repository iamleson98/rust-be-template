import { useEffect } from 'react'
import { useSearchForm } from '@/stores/search-form'
import { SearchResults } from './search-results'
import { useSearchUrl } from './use-search-url'

/** `/search`: the URL is the source of truth; the form store mirrors it so the search widget stays in sync. */
export function SearchPage() {
  const { search } = useSearchUrl()
  const setSearchParams = useSearchForm((s) => s.setSearchParams)
  useEffect(() => {
    setSearchParams(search)
  }, [search, setSearchParams])
  return <SearchResults />
}
