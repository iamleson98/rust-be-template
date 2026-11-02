import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@spa/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@spa/components/ui/card";
import { DatePicker } from "@spa/components/ui/date-picker";
import { Label } from "@spa/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@spa/components/ui/select";
import { useT } from "@spa/lib/i18n";
import { vnDate } from "@spa/lib/search-params";
import type { ProfileRoute } from "./api";

const routeLabel = (r: ProfileRoute) => `${r.from.name} → ${r.to.name}`;

/**
 * The page's main job: book this operator. One of their routes, a day, and
 * the search opens already filtered to them.
 */
export function BrandQuickBook({
  brandName,
  routes,
  onSearch,
}: {
  brandName: string;
  routes: ProfileRoute[];
  onSearch: (route: ProfileRoute, date: string) => void;
}) {
  const t = useT();
  const [routeId, setRouteId] = useState(routes[0]?.id ?? "");
  const [date, setDate] = useState(() => vnDate(1));
  if (routes.length === 0) return null;
  const route = routes.find((r) => r.id === routeId);

  return (
    <Card className="gap-4 shadow-float">
      <CardHeader>
        <CardTitle>{t("brandPage.quickBookTitle", { brand: brandName })}</CardTitle>
        <CardDescription>{t("brandPage.quickBookSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_auto] lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (route) onSearch(route, date);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="brand-route">{t("brandPage.route")}</Label>
            <Select
              value={routeId}
              onValueChange={setRouteId}
              items={routes.map((r) => ({ value: r.id, label: routeLabel(r) }))}
            >
              <SelectTrigger id="brand-route" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {routes.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {routeLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="brand-date">{t("brandPage.date")}</Label>
            <DatePicker
              id="brand-date"
              value={date}
              onChange={(d) => d && setDate(d)}
              minDate={vnDate(0)}
              clearable={false}
              lunar
              triggerClassName="h-11"
            />
          </div>
          <Button type="submit" size="lg" className="h-11">
            <Search />
            {t("nav.searchTrips")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
