"use client";

/**
 * The basic-fields section of ScheduleFormDialog — departure time,
 * vehicle & seat layout, effective window.
 *
 * The LAYOUT is the single vehicle choice: the picker is grouped by
 * vehicle class (the shared canonical catalog + the brand's customs)
 * and the schedule's vehicleType follows it server-side. The class
 * picker only appears when running without a layout, where the backend
 * falls back to the class's typical capacity.
 *
 * Extracted from the original 'src/features/admin/schedules/schedule-form.tsx'.
 */

import { DatePicker } from "@spa/components/ui/date-picker";
import { InfiniteSelect } from "@spa/components/ui/infinite-select";
import { TimePicker } from "@spa/components/ui/time-picker";
import { ComboboxField, type ComboboxFieldGroup } from "@spa/components/ui/combobox";
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@spa/components/ui/form";
import { fetchVehicleTypesPage } from "@spa/features/admin/vehicle-types/api";
import { useT } from "@spa/lib/i18n";
import type { AdminBusLayoutOut, AdminVehicleTypeOut } from "@spa/api";
import { vehicleCodeLabel } from "@spa/features/admin/brands/brand-tree-helpers";
import { NO_LAYOUT, type ScheduleFormInstance } from "./schedule-schema";

/** Combobox group ordering — the catalog's sort order. */
const CLASS_ORDER: Record<string, number> = {
  limousine: 1,
  sleeper: 2,
  semi_sleeper: 3,
  minivan: 4,
  standard: 5,
};

export function ScheduleBasicsFields({
  form,
  busLayouts,
  effectiveFrom,
  scheduleVehicleType,
}: {
  form: ScheduleFormInstance;
  busLayouts: AdminBusLayoutOut[];
  effectiveFrom: string;
  scheduleVehicleType: AdminVehicleTypeOut | undefined;
}) {
  const t = useT();
  // The vehicle picker: global canonical catalog + brand customs, one
  // group per vehicle class so "which bus" reads at a glance.
  const layoutGroups: ComboboxFieldGroup[] = (() => {
    const byClass = new Map<string, AdminBusLayoutOut[]>();
    for (const layout of busLayouts) {
      const key = layout.vehicleType ?? "custom";
      const list = byClass.get(key) ?? [];
      list.push(layout);
      byClass.set(key, list);
    }
    const classes = [...byClass.keys()].sort(
      (a, b) => (CLASS_ORDER[a] ?? 9) - (CLASS_ORDER[b] ?? 9) || a.localeCompare(b),
    );
    return classes.map((cls) => ({
      label: cls === "custom" ? t("adminSchedules.customLayoutGroup") : vehicleCodeLabel(cls),
      items: (byClass.get(cls) ?? [])
        .slice()
        .sort((a, b) => (b.totalSeats ?? 0) - (a.totalSeats ?? 0))
        .map((l) => ({
          value: l.id,
          label: l.totalSeats
            ? `${l.name ?? t("adminSchedules.layoutFallback")} · ${t("busLayouts.seatsCount", { count: l.totalSeats })}`
            : (l.name ?? t("adminSchedules.layoutFallback")),
        })),
    }));
  })();

  const busLayoutId = form.watch("busLayoutId");
  const noLayout = !busLayoutId || busLayoutId === NO_LAYOUT;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 items-start">
        <FormField
          control={form.control}
          name="departureTime"
          render={({ field }) => (
            <FormItem className="grid gap-1.5">
              <FormLabel>
                {t("brands.sortDeparture")} <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <TimePicker value={field.value} onChange={(v) => field.onChange(v ?? "")} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="busLayoutId"
          render={({ field }) => (
            // min-w-0: a long layout name truncates instead of widening the column.
            <FormItem className="grid min-w-0 gap-1.5">
              <FormLabel>{t("adminSchedules.vehicleLayout")}</FormLabel>
              <FormControl>
                <ComboboxField
                  value={field.value || NO_LAYOUT}
                  onValueChange={(v) => field.onChange(v === NO_LAYOUT ? "" : v)}
                  items={[
                    {
                      label: t("adminSchedules.noLayoutGroup"),
                      items: [{ value: NO_LAYOUT, label: t("adminSchedules.noLayoutOption") }],
                    },
                    ...layoutGroups,
                  ]}
                  placeholder={t("adminSchedules.chooseSeatLayout")}
                  searchPlaceholder={t("adminSchedules.searchSeatLayout")}
                  emptyText={
                    busLayouts.length === 0
                      ? t("adminSchedules.noLayoutsYet")
                      : t("combobox.noMatch")
                  }
                  aria-label={t("adminSchedules.vehicleLayout")}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {noLayout && (
        <div className="grid grid-cols-2 gap-3 items-start">
          <FormField
            control={form.control}
            name="vehicleTypeId"
            render={({ field }) => (
              <FormItem className="grid gap-1.5">
                <FormLabel>
                  {t("adminSchedules.vehicleTypeManual")}{" "}
                  <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <InfiniteSelect<AdminVehicleTypeOut>
                    scope="vehicle-types"
                    fetchPage={fetchVehicleTypesPage}
                    value={field.value || null}
                    onValueChange={(v) => field.onChange(v ?? "")}
                    itemValue={(vt) => vt.id}
                    itemLabel={(vt) => vt.label}
                    extraItems={scheduleVehicleType ? [scheduleVehicleType] : []}
                    placeholder={t("adminSchedules.chooseVehicleType")}
                    searchPlaceholder={t("adminSchedules.searchVehicleType")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <p className="self-end text-xs text-muted-foreground pb-2">
            {t("adminSchedules.vehicleLayoutHint")}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 items-start">
        <FormField
          control={form.control}
          name="effectiveFrom"
          render={({ field }) => (
            <FormItem className="grid gap-1.5">
              <FormLabel>
                {t("adminSchedules.effectiveFrom")} <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <DatePicker
                  value={field.value}
                  onChange={(v) => field.onChange(v ?? "")}
                  placeholder={t("adminSchedules.chooseStartDate")}
                  clearable={false}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="effectiveTo"
          render={({ field }) => (
            <FormItem className="grid gap-1.5">
              <FormLabel>
                {t("adminSchedules.effectiveTo")} <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <DatePicker
                  value={field.value}
                  onChange={(v) => field.onChange(v ?? "")}
                  placeholder={t("adminSchedules.chooseEndDate")}
                  minDate={effectiveFrom || undefined}
                  clearable={false}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </>
  );
}
