"use client";

import type { SearchParams } from "@spa/lib/search-params";
import type { UseFormReturn } from "react-hook-form";
import { useT } from "@spa/lib/i18n";
import { FormField, FormItem, FormLabel, FormMessage } from "@spa/components/ui/form";
import { FIELD_CONTROL, FIELD_ERROR, FIELD_ITEM, FIELD_LABEL } from "./field-style";
import { TripDatePicker } from "./trip-date-picker";
import type { SearchFormValues } from "./schema";

/**
 * The travel day with an optional "leaving from" time (only trips departing
 * at or after it are listed), and the return day: picking one makes the
 * search a round trip, clearing it makes it one-way again.
 */
export function SearchDateFields({
  form,
  searchParams,
  setSearchParams,
}: {
  form: UseFormReturn<SearchFormValues>;
  searchParams: SearchParams;
  setSearchParams: (p: Partial<SearchParams>) => void;
}) {
  const t = useT();
  const today = new Date();

  const setReturn = (returnDate: string) => {
    const roundTrip = returnDate !== "";
    form.setValue("returnDate", returnDate, { shouldValidate: form.formState.isSubmitted });
    form.setValue("roundTrip", roundTrip);
    setSearchParams({ returnDate, roundTrip });
  };

  return (
    <>
      <FormField
        control={form.control}
        name="date"
        render={({ field }) => (
          <FormItem className={FIELD_ITEM}>
            <FormLabel className={FIELD_LABEL}>
              {t("search.date")}{" "}
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </FormLabel>
            <TripDatePicker
              day={field.value}
              onDay={(date) => {
                field.onChange(date);
                setSearchParams({ date });
                // A return day before the new outbound day no longer makes sense.
                if (searchParams.returnDate && searchParams.returnDate < date) setReturn("");
              }}
              time={searchParams.time}
              onTime={(time) => {
                form.setValue("time", time);
                setSearchParams({ time });
              }}
              minDate={today}
              title={t("search.date")}
              placeholder={t("home.chooseDatePh")}
              triggerClassName={FIELD_CONTROL}
            />
            <FormMessage className={FIELD_ERROR} />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="returnDate"
        render={({ field }) => (
          <FormItem className={FIELD_ITEM}>
            <FormLabel className={FIELD_LABEL}>{t("search.returnDate")}</FormLabel>
            <TripDatePicker
              day={field.value}
              onDay={setReturn}
              onClear={() => setReturn("")}
              minDate={searchParams.date ? new Date(`${searchParams.date}T00:00:00`) : today}
              title={t("search.returnDate")}
              placeholder={t("search.addReturn")}
              triggerClassName={FIELD_CONTROL}
            />
            <FormMessage className={FIELD_ERROR} />
          </FormItem>
        )}
      />
    </>
  );
}
