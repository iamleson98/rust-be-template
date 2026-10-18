"use client";

import { ArrowDownWideNarrow, Clock, Navigation2, Star, type LucideIcon } from "lucide-react";
import { useT } from "@spa/lib/i18n";
import { VEHICLE_TYPES } from "@spa/lib/vehicle-types";
import { facetCount, toggle } from "./filters";
import { cn } from "@spa/lib/utils";
import type { SearchFacets } from "@spa/api";
import type { SortKey } from "@spa/lib/search-params";
import { CheckRow, FilterSection } from "./filter-ui";
import { useSearchUrl } from "./use-search-url";

const SORTS: { key: SortKey; labelKey: string; Icon: LucideIcon }[] = [
  { key: "distance", labelKey: "searchPage.sortNearest", Icon: Navigation2 },
  { key: "departure", labelKey: "searchPage.departureTime", Icon: Clock },
  { key: "price", labelKey: "searchPage.sortCheapest", Icon: ArrowDownWideNarrow },
  { key: "rating", labelKey: "searchPage.rating", Icon: Star },
];

/**
 * Sort order, as a row of pills above the results (it lives in the URL and
 * re-runs the query). "Nearest" only between exact places, where it is the
 * default.
 */
export function SortTabs() {
  const t = useT();
  const { search, update } = useSearchUrl();
  const exact = search.fromLat !== undefined;
  const sorts = exact ? SORTS : SORTS.filter((o) => o.key !== "distance");
  const current = !exact && search.sort === "distance" ? "departure" : search.sort;
  return (
    <div
      role="radiogroup"
      aria-label={t("searchPage.sort")}
      className="-m-1 flex min-w-0 gap-1.5 overflow-x-auto p-1 scrollbar-none"
    >
      {sorts.map((o) => {
        const active = current === o.key;
        return (
          <button
            key={o.key}
            role="radio"
            aria-checked={active}
            onClick={() => update({ sort: o.key })}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors sm:px-3.5",
              active
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300",
            )}
          >
            {/* Phones: labels only, so all three fit beside the filter button. */}
            <o.Icon className="hidden size-3.5 sm:block" />
            {t(o.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

/** Vehicle type: the filter that lives in the URL. Counts cover every match. */
export function UrlFilters({ facets }: { facets: SearchFacets | undefined }) {
  const t = useT();
  const { search, update } = useSearchUrl();
  return (
    <FilterSection title={t("searchPage.vehicleType")} first>
      <div className="space-y-1.5">
        {VEHICLE_TYPES.map((v) => (
          <CheckRow
            key={v.key}
            checked={search.vehicleTypes.includes(v.key)}
            onChange={() => update({ vehicleTypes: toggle(search.vehicleTypes, v.key) })}
            icon={<v.Icon className="h-3.5 w-3.5" />}
            count={facetCount(facets?.vehicleTypes, v.key)}
          >
            {t(v.labelKey)}
          </CheckRow>
        ))}
      </div>
    </FilterSection>
  );
}
