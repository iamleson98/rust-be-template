"use client";

import { useSearchForm } from "@spa/stores/search-form";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useT } from "@spa/lib/i18n";
import { useNavigate } from "@tanstack/react-router";
import { Form } from "@spa/components/ui/form";
import { Button } from "@spa/components/ui/button";
import { Search } from "lucide-react";
import { buildSearchInput } from "@spa/lib/search-params";
import { cn } from "@spa/lib/utils";
import { useMediaQuery } from "@spa/hooks/use-media-query";
import { searchSchema, type SearchFormValues } from "./schema";
import { SearchRouteFields } from "./route-fields";
import { SearchDateFields } from "./date-fields";
import { SearchPassengerPicker } from "./passenger-picker";
import { SearchActionsRow } from "./actions-row";
import { PopularRoutesQuickSelect } from "./popular-routes-quick-select";
import { MobileSearchSummary } from "./mobile-search-summary";

/**
 * The order a submitted search starts in: between exact places, nearest stops
 * first unless the customer picked another order; "nearest" means nothing
 * between cities.
 */
function searchSort(v: SearchFormValues): SearchFormValues["sort"] {
  const exact = [v.fromLat, v.fromLon, v.toLat, v.toLon].every((n) => typeof n === "number");
  if (exact) return v.sort === "departure" ? "distance" : v.sort;
  return v.sort === "distance" ? "departure" : v.sort;
}

export function SearchWidget({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const searchParams = useSearchForm((s) => s.searchParams);
  const setSearchParams = useSearchForm((s) => s.setSearchParams);
  const navigate = useNavigate();
  // Below lg (phones and tablets) the results page shows a one-line summary instead of the form row.
  const narrow = useMediaQuery("(max-width: 1023px)");
  const [paxOpen, setPaxOpen] = useState(false);
  // Mobile (compact mode): the stacked form lives in a bottom sheet that
  // opens from the one-line summary row — a 48px bar instead of a ~380px
  // stacked form covering the results on phones.
  const [mobileFormOpen, setMobileFormOpen] = useState(false);
  // Local "submitting" flag — we briefly disable the submit button while
  // the router is navigating to /search so the user gets visual feedback.
  // (The actual data fetch happens on the /search route via useTripSearch.)
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<SearchFormValues>({
    resolver: zodResolver(searchSchema),
    defaultValues: searchParams,
    // Errors appear on submit, then follow each change: an error popping up
    // on blur shifts the layout under the pointer and swallows the click.
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  // Sync store → form. The comparison guard means we only `reset` when
  // the store has actually diverged from the form's internal state
  // (e.g. the user clicked a popular-route chip or the swap button).
  // On every ordinary keystroke `field.onChange` + `setSearchParams`
  // move both layers together, so the guard short-circuits and we
  // don't clobber field errors / dirty state.
  useEffect(() => {
    const cur = form.getValues();
    const a = [...(cur.vehicleTypes ?? [])].sort().join(",");
    const b = [...(searchParams.vehicleTypes ?? [])].sort().join(",");
    const coordsDiverged =
      (cur.fromLat ?? null) !== (searchParams.fromLat ?? null) ||
      (cur.fromLon ?? null) !== (searchParams.fromLon ?? null) ||
      (cur.toLat ?? null) !== (searchParams.toLat ?? null) ||
      (cur.toLon ?? null) !== (searchParams.toLon ?? null);
    if (
      cur.from !== searchParams.from ||
      cur.to !== searchParams.to ||
      cur.date !== searchParams.date ||
      cur.time !== searchParams.time ||
      cur.returnDate !== searchParams.returnDate ||
      cur.adults !== searchParams.adults ||
      cur.children !== searchParams.children ||
      cur.roundTrip !== searchParams.roundTrip ||
      cur.sort !== searchParams.sort ||
      a !== b ||
      coordsDiverged
    ) {
      form.reset(searchParams);
    }
  }, [searchParams, form]);

  const swap = useCallback(() => {
    // Swap names AND any smart-search coordinates so a swapped precise
    // pick stays a precise pick (coords belong to the place, not the slot).
    setSearchParams({
      from: searchParams.to,
      to: searchParams.from,
      fromLat: searchParams.toLat,
      fromLon: searchParams.toLon,
      toLat: searchParams.fromLat,
      toLon: searchParams.fromLon,
      fromCity: searchParams.toCity,
      toCity: searchParams.fromCity,
    });
  }, [
    searchParams.from,
    searchParams.to,
    searchParams.fromLat,
    searchParams.fromLon,
    searchParams.toLat,
    searchParams.toLon,
    searchParams.fromCity,
    searchParams.toCity,
    setSearchParams,
  ]);

  const onValid = useCallback(
    async (submitted: SearchFormValues) => {
      const values = { ...submitted, sort: searchSort(submitted) };
      // Navigate to the /search route with typed search params — the route's
      // `validateSearch` parses them and `useTripSearch` runs the actual fetch.
      // We still call `setSearchParams` so the form stays in sync with the
      // last-submitted values (used for round-trip UI and persistence).
      setSearchParams({
        from: values.from,
        to: values.to,
        date: values.date,
        time: values.time,
        adults: values.adults,
        children: values.children,
        sort: values.sort,
        roundTrip: values.roundTrip,
        returnDate: values.returnDate,
        vehicleTypes: values.vehicleTypes,
        fromLat: values.fromLat,
        fromLon: values.fromLon,
        toLat: values.toLat,
        toLon: values.toLon,
        fromCity: values.fromCity,
        toCity: values.toCity,
      });
      setSubmitting(true);
      try {
        navigate({
          to: "/search",
          search: buildSearchInput({
            from: values.from,
            to: values.to,
            date: values.date,
            time: values.time,
            adults: values.adults,
            children: values.children,
            sort: values.sort,
            vehicleTypes: values.vehicleTypes,
            roundTrip: values.roundTrip,
            returnDate: values.returnDate,
            fromLat: values.fromLat,
            fromLon: values.fromLon,
            toLat: values.toLat,
            toLon: values.toLon,
            fromCity: values.fromCity,
            toCity: values.toCity,
          }),
        });
      } finally {
        // Reset shortly after navigation — the route transition is async.
        setTimeout(() => setSubmitting(false), 300);
      }
    },
    [setSearchParams, navigate],
  );

  // Form submission can also be triggered programmatically (the search
  // button lives inside the <form> so this is mostly a convenience for
  // tests / future keyboard shortcuts). The shared DatePicker surfaces
  // its own validation message, so no manual "open the picker" hint.
  const onSubmit = form.handleSubmit(onValid);

  // ── Compact mode below lg: summary row + bottom-sheet form ──
  // The stacked form filled a phone's (and a tablet's) first screen and pushed
  // the results below the fold. The summary keeps the sticky bar to one line;
  // tapping it opens the form in a sheet with big touch targets.
  if (compact && narrow) {
    return (
      <MobileSearchSummary
        searchParams={searchParams}
        setSearchParams={setSearchParams}
        swap={swap}
        onOpen={() => setMobileFormOpen(true)}
        sheetOpen={mobileFormOpen}
        setSheetOpen={setMobileFormOpen}
        form={form}
        onSubmit={form.handleSubmit(async (values) => {
          await onValid(values);
          setMobileFormOpen(false);
        })}
        submitting={submitting}
      />
    );
  }

  return (
    <div
      className={cn(
        "relative z-50 bg-white",
        compact
          ? "rounded-2xl border border-slate-200 p-3"
          : "rounded-3xl p-4 shadow-float ring-1 ring-slate-900/5 sm:p-5 md:p-6",
      )}
    >
      <Form {...form}>
        <form onSubmit={onSubmit} className="contents" noValidate aria-label={t("search.title")}>
          {compact ? (
            /* ── Compact bar (results page, ≥ lg): one row. Every field has
                the same label and 44px control (see field-style.ts), so
                `items-end` lines them all up — the swap and search buttons
                too. Vehicle types stay in the results filters. ── */
            <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[minmax(0,1.25fr)_auto_minmax(0,1.25fr)_minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.65fr)_auto] lg:items-end">
              <SearchRouteFields form={form} swap={swap} />
              <SearchDateFields
                form={form}
                searchParams={searchParams}
                setSearchParams={setSearchParams}
              />
              <SearchPassengerPicker
                form={form}
                searchParams={searchParams}
                setSearchParams={setSearchParams}
                paxOpen={paxOpen}
                setPaxOpen={setPaxOpen}
              />
              <Button
                type="submit"
                disabled={submitting}
                className="h-11 w-full shrink-0 gap-2 rounded-xl px-5 md:h-11 lg:w-auto"
              >
                <Search className="h-4 w-4" />
                <span>{submitting ? t("home.searching") : t("search.btn")}</span>
              </Button>
            </div>
          ) : (
            /* ── Full widget (home page) ── */
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.2fr)_auto_minmax(0,1.2fr)_minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.7fr)] md:items-end">
                <SearchRouteFields form={form} swap={swap} layout="auto" />

                {/* Phones: the two days side by side, then passengers; md: grid cells. */}
                <div className="grid grid-cols-2 gap-3 md:contents">
                  <SearchDateFields
                    form={form}
                    searchParams={searchParams}
                    setSearchParams={setSearchParams}
                  />

                  <SearchPassengerPicker
                    form={form}
                    searchParams={searchParams}
                    setSearchParams={setSearchParams}
                    paxOpen={paxOpen}
                    setPaxOpen={setPaxOpen}
                  />
                </div>
              </div>

              <SearchActionsRow
                form={form}
                searchParams={searchParams}
                setSearchParams={setSearchParams}
                submitting={submitting}
              />
            </>
          )}
        </form>
      </Form>

      {/* Popular routes quick-select */}
      {!compact && (
        <PopularRoutesQuickSelect searchParams={searchParams} setSearchParams={setSearchParams} />
      )}
    </div>
  );
}
