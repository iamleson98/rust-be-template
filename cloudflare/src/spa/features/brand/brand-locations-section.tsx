import { useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import { Button } from "@spa/components/ui/button";
import { Card, CardContent } from "@spa/components/ui/card";
import { HomeSection } from "@spa/features/home/section";
import { useT } from "@spa/lib/i18n";
import type { ProfileLocation } from "./api";
import { SECTION_IDS, SECTION_SCROLL_MARGIN } from "./brand-format";

/** Locations shown before "show more"; the rest are already loaded. */
const FIRST_LOCATIONS = 6;

const mapUrl = (l: ProfileLocation) =>
  `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lon}`;

/** The brand's offices, stations and pickup points, by city (the server sends them sorted). */
export function BrandLocationsSection({
  brandName,
  locations,
}: {
  brandName: string;
  locations: ProfileLocation[];
}) {
  const t = useT();
  const [all, setAll] = useState(false);
  if (locations.length === 0) return null;
  const shown = all ? locations : locations.slice(0, FIRST_LOCATIONS);
  const cities = [...new Set(shown.map((l) => l.city ?? ""))];

  return (
    <HomeSection
      id={SECTION_IDS.locations}
      className={SECTION_SCROLL_MARGIN}
      title={t("brandPage.locationsTitle")}
      subtitle={t("brandPage.locationsSubtitle", { brand: brandName })}
    >
      <div className="space-y-5">
        {cities.map((city) => (
          <div key={city}>
            {city && <h3 className="mb-2 text-sm font-semibold text-slate-700">{city}</h3>}
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown
                .filter((l) => (l.city ?? "") === city)
                .map((l) => (
                  <li key={l.id} className="min-w-0">
                    <Card className="h-full py-4">
                      <CardContent className="flex items-start gap-3 px-4">
                        <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-900">{l.name}</p>
                          {l.address && <p className="text-sm text-slate-500">{l.address}</p>}
                          {l.lat != null && l.lon != null && (
                            <a
                              href={mapUrl(l)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                            >
                              {t("brandPage.openMap")}
                              <ExternalLink className="size-3" />
                            </a>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
      {locations.length > FIRST_LOCATIONS && (
        <div className="mt-4 text-center">
          <Button variant="outline" size="sm" onClick={() => setAll((v) => !v)}>
            {all
              ? t("brandPage.showLess")
              : t("brandPage.showMore", { count: locations.length - FIRST_LOCATIONS })}
          </Button>
        </div>
      )}
    </HomeSection>
  );
}
