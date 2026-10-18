"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, cityLabel, fmtVnd, type TripItem } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, SearchX, Users } from "lucide-react";

interface SearchResponse {
  items: TripItem[];
  facets: {
    vehicleTypes: { code: string; label: string; count: number }[];
    brands: { slug: string; name: string; count: number }[];
    hourBands: Record<string, number>;
    minPrice: number | null;
    maxPrice: number | null;
  };
  total: number;
}

const HOUR_LABELS: Record<string, string> = {
  "0-6": "Sớm (00–06h)",
  "6-12": "Sáng (06–12h)",
  "12-18": "Chiều (12–18h)",
  "18-24": "Tối (18–24h)",
};

function SearchResultsInner() {
  const params = useSearchParams();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const date = params.get("date") ?? "";

  const [vehicleTypes, setVehicleTypes] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [hourBands, setHourBands] = useState<string[]>([]);
  const [sort, setSort] = useState<"departure" | "price">("departure");

  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const q = new URLSearchParams({ from, to, date, sort });
    if (vehicleTypes.length) q.set("vehicle_types", vehicleTypes.join(","));
    if (brands.length) q.set("brands", brands.join(","));
    if (hourBands.length) q.set("hour_bands", hourBands.join(","));
    return q.toString();
  }, [from, to, date, sort, vehicleTypes, brands, hourBands]);

  const missingParams = !from || !to || !date;

  useEffect(() => {
    if (missingParams) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch lifecycle: flag the load before awaiting
    setLoading(true);
    api
      .get<SearchResponse>(`/api/search?${query}`)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, missingParams]);

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold sm:text-2xl">
          {cityLabel(from)} → {cityLabel(to)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {date.split("-").reverse().join("/")} · {loading ? "Đang tìm…" : `${data?.total ?? 0} chuyến`}
        </p>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="w-full shrink-0 space-y-4 lg:w-60" aria-label="Bộ lọc">
          <Card className="border">
            <CardContent className="space-y-4 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Sắp xếp</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSort(sort === "departure" ? "price" : "departure")}
                >
                  {sort === "departure" ? "Giờ đi" : "Giá"}
                </Button>
              </div>

              {data && data.facets.vehicleTypes.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Loại xe</p>
                  {data.facets.vehicleTypes.map((vt) => (
                    <label key={vt.code} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={vehicleTypes.includes(vt.code)}
                        onCheckedChange={() => toggle(vehicleTypes, setVehicleTypes, vt.code)}
                        aria-label={vt.label}
                      />
                      <span className="flex-1">{vt.label}</span>
                      <span className="text-xs text-muted-foreground">{vt.count}</span>
                    </label>
                  ))}
                </div>
              )}

              {data && data.facets.brands.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Nhà xe</p>
                  {data.facets.brands.map((b) => (
                    <label key={b.slug} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={brands.includes(b.slug)}
                        onCheckedChange={() => toggle(brands, setBrands, b.slug)}
                        aria-label={b.name}
                      />
                      <span className="flex-1">{b.name}</span>
                      <span className="text-xs text-muted-foreground">{b.count}</span>
                    </label>
                  ))}
                </div>
              )}

              {data && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Giờ xuất phát</p>
                  {Object.entries(HOUR_LABELS).map(([band, label]) => (
                    <label key={band} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={hourBands.includes(band)}
                        onCheckedChange={() => toggle(hourBands, setHourBands, band)}
                        aria-label={label}
                      />
                      <span className="flex-1">{label}</span>
                      <span className="text-xs text-muted-foreground">{data.facets.hourBands[band] ?? 0}</span>
                    </label>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </aside>

        <div className="min-w-0 flex-1 space-y-3">
          {loading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}

          {!loading && (error || missingParams) && (
            <Card className="border">
              <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                <SearchX className="size-10 text-muted-foreground" aria-hidden />
                <p className="text-muted-foreground">{missingParams ? "Thiếu điểm đi, điểm đến hoặc ngày đi." : error}</p>
                <Link href="/">
                  <Button variant="outline">Về trang chủ</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {!loading && !error && !missingParams && data?.items.length === 0 && (
            <Card className="border">
              <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                <SearchX className="size-10 text-muted-foreground" aria-hidden />
                <p className="text-muted-foreground">
                  Không có chuyến phù hợp. Thử đổi ngày hoặc bỏ bớt bộ lọc.
                </p>
              </CardContent>
            </Card>
          )}

          {!loading &&
            !error &&
            !missingParams &&
            data?.items.map((t) => (
              <Link key={t.id} href={`/trips/${t.id}`} className="block" aria-label={`Xem chi tiết chuyến ${t.route.name}`}>
                <Card className="border transition-colors hover:border-primary/50">
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Clock className="size-4 text-muted-foreground" aria-hidden />
                        <span className="text-lg font-bold">{t.departureTime}</span>
                        <span className="text-sm text-muted-foreground">
                          {t.departureDate.slice(5).split("-").reverse().join("/")}
                        </span>
                      </div>
                      <p className="truncate font-medium">{t.route.name}</p>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        {t.brand && <span>{t.brand.name}</span>}
                        {t.vehicleType && <Badge variant="secondary">{t.vehicleType.label}</Badge>}
                        <span className="flex items-center gap-1">
                          <Users className="size-3.5" aria-hidden /> {t.availableSeats} ghế
                        </span>
                      </div>
                      {t.amenities.length > 0 && (
                        <p className="truncate text-xs text-muted-foreground">{t.amenities.join(" · ")}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end">
                      <p className="text-lg font-bold text-primary">{fmtVnd(t.price.adult)}</p>
                      <Button size="sm">Chọn chuyến</Button>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
        </div>
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-6"><Skeleton className="h-64 w-full" /></div>}>
      <SearchResultsInner />
    </Suspense>
  );
}
