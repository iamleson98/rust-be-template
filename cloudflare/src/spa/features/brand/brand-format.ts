import { useLocale, useT } from "@spa/lib/i18n";
import { vnDate } from "@spa/lib/search-params";

/** "Hôm nay" / "Ngày mai" / "T4, 04/11" for a Vietnamese `YYYY-MM-DD`. */
export function useDayLabel() {
  const locale = useLocale();
  const t = useT();
  return (date: string) => {
    if (date === vnDate(0)) return t("brandPage.today");
    if (date === vnDate(1)) return t("brandPage.tomorrow");
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00Z`));
  };
}

/** "T2, T4" / "Mon, Wed" from a Monday-first `1`/`0` mask; null (every day) is "Daily". */
export function useDaysLabel() {
  const locale = useLocale();
  const t = useT();
  return (mask: string | null) => {
    if (!mask || !mask.includes("0")) return t("brandPage.daily");
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
    // 2024-01-01 was a Monday.
    return Array.from({ length: 7 }, (_, i) => weekday.format(new Date(Date.UTC(2024, 0, 1 + i))))
      .filter((_, i) => mask[i] === "1")
      .join(", ");
  };
}

/** Section ids, shared by the sections and the page's section nav. */
export const SECTION_IDS = {
  routes: "tuyen-duong",
  trips: "chuyen-sap-chay",
  locations: "dia-diem",
  reviews: "danh-gia",
} as const;

/** Leaves room for the sticky header and section nav when a section is jumped to. */
export const SECTION_SCROLL_MARGIN = "scroll-mt-[calc(var(--header-h)+3.5rem)]";
