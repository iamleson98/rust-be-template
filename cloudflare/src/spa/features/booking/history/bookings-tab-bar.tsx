"use client";

import { CalendarCheck, History, X } from "lucide-react";
import { PillTab, PillTabs } from "@spa/components/console/pill-tabs";
import { useT } from "@spa/lib/i18n";

/** Upcoming / past / cancelled: one scrollable row, never wrapping. */
export function BookingsTabBar({
  upcomingCount,
  pastCount,
  cancelledCount,
}: {
  upcomingCount: number;
  pastCount: number;
  cancelledCount: number;
}) {
  const t = useT();
  return (
    <PillTabs>
      <PillTab
        value="upcoming"
        icon={<CalendarCheck />}
        label={t("bookingHistory.upcoming")}
        count={upcomingCount}
      />
      <PillTab value="past" icon={<History />} label={t("bookingHistory.past")} count={pastCount} />
      <PillTab
        value="cancelled"
        icon={<X />}
        label={t("bookingHistory.statusCancelled")}
        count={cancelledCount}
      />
    </PillTabs>
  );
}
