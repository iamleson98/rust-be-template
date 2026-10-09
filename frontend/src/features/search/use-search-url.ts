import { useNavigate, useSearch } from '@tanstack/react-router'
import { buildSearchInput, type SearchInput } from '@/lib/search-params'

/** The `/search` URL as state: read it, or patch it (the URL is the source of truth, so the query re-runs). */
export function useSearchUrl() {
  const search = useSearch({ from: '/search' })
  const navigate = useNavigate()
  const update = (changes: SearchInput) =>
    navigate({ to: '/search', search: buildSearchInput({ ...search, ...changes }) })
  return { search, update }
}
