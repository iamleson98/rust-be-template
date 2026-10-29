import { useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { buildSearchInput, parseSearch, type SearchInput } from "@spa/lib/search-params";

/**
 * The `/search` URL as state: read it, or patch it (the URL is the source of
 * truth, so the query re-runs). `replace` rewrites the current history entry
 * instead of adding one: a filter tweak is not a step for Back to undo.
 */
export function useSearchUrl() {
  const query = useSearch({ from: "/search" });
  const navigate = useNavigate();
  const search = useMemo(() => parseSearch(query), [query]);
  const update = (changes: SearchInput, { replace = false }: { replace?: boolean } = {}) =>
    navigate({ to: "/search", search: buildSearchInput({ ...search, ...changes }), replace });
  return { search, update };
}
