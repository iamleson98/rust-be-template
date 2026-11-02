import { Badge } from "@spa/components/ui/badge";
import { buttonVariants } from "@spa/components/ui/button";
import { useT } from "@spa/lib/i18n";
import { cn } from "@spa/lib/utils";
import { SECTION_IDS } from "./brand-format";

/**
 * Jump links to the page's sections, pinned under the site header, so a
 * phone user reaches the trips or the reviews without scrolling past the
 * rest. Each link says how much is there.
 */
export function BrandSectionNav({
  routes,
  trips,
  locations,
  reviews,
}: {
  routes: number;
  trips: number;
  locations: number;
  reviews: number;
}) {
  const t = useT();
  const links = [
    { id: SECTION_IDS.routes, label: t("brandPage.statRoutes"), count: routes },
    { id: SECTION_IDS.trips, label: t("brandPage.statUpcoming"), count: trips },
    ...(locations > 0
      ? [{ id: SECTION_IDS.locations, label: t("brandPage.navLocations"), count: locations }]
      : []),
    { id: SECTION_IDS.reviews, label: t("tripDetail.tabReviews"), count: reviews },
  ];
  return (
    <nav
      aria-label={t("brandPage.sectionNav")}
      className="sticky top-(--header-h) z-20 border-b border-slate-200/80 bg-canvas/95 backdrop-blur-xl"
    >
      <ul className="page-x flex gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
        {links.map((l) => (
          <li key={l.id} className="shrink-0">
            <a
              href={`#${l.id}`}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "rounded-full")}
            >
              {l.label}
              <Badge variant="secondary" className="tabular-nums">
                {l.count}
              </Badge>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
