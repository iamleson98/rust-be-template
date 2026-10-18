import Link from "next/link";
import { SearchForm } from "@/components/features/search-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { Bus, Clock, ShieldCheck, Sparkles, Star, Wifi } from "lucide-react";

export const dynamic = "force-dynamic";

async function getHomeData() {
  try {
    const brands = await rawAll<{ slug: string; name: string; rating: number | null; description: string | null; logo_url: string | null; total_trips: number }>(
      sql`SELECT slug, name, rating, description, logo_url, total_trips FROM brand WHERE status = 'active' ORDER BY rating DESC LIMIT 8`,
    );
    const trips = await rawAll<{
      id: string;
      route_name: string;
      departure_date: string;
      departure_time: string;
      brand_name: string | null;
      available_seats: number;
      price: number | null;
      vt_label: string | null;
    }>(sql`
      WITH RECURSIVE ranked AS (
        SELECT ts.id, r.name AS route_name, ts.departure_date, s.departure_time,
               b.name AS brand_name, ts.available_seats, vt.label AS vt_label,
               (SELECT COALESCE(
                 (SELECT MIN(final_price) FROM seat_inventory si WHERE si.trip_session_id = ts.id AND si.status = 'available'),
                 (SELECT MIN(price_adult) FROM schedule_fare sf WHERE sf.schedule_id = s.id),
                 s.base_price_adult)) AS price,
               ROW_NUMBER() OVER (ORDER BY ts.available_seats DESC, ts.departure_date, s.departure_time) AS rn
        FROM trip_session ts
        JOIN schedule s ON s.id = ts.schedule_id
        JOIN route r ON r.id = s.route_id
        LEFT JOIN brand b ON b.id = r.brand_id
        LEFT JOIN vehicle_type vt ON vt.id = s.vehicle_type_id
        WHERE ts.departure_date >= date('now') AND ts.status = 'scheduled'
      )
      SELECT id, route_name, departure_date, departure_time, brand_name, available_seats, price, vt_label
      FROM ranked WHERE rn <= 6
    `);
    return { brands, trips };
  } catch {
    return { brands: [], trips: [] };
  }
}

export default async function HomePage() {
  const { brands, trips } = await getHomeData();
  const fmt = (n: number | null) =>
    n == null ? "—" : Math.round(n).toLocaleString("vi-VN").replace(/,/g, ".") + "₫";

  return (
    <div className="flex flex-col">
      {/* Hero + search */}
      <section className="border-b bg-gradient-to-b from-primary/10 via-background to-background">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
          <div className="mb-6 text-center sm:mb-8">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Đặt vé xe khách <span className="text-primary">toàn quốc</span>
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
              Limousine, giường nằm, ghế ngồi — so sánh giá, chọn ghế và thanh toán chỉ trong một phút.
            </p>
          </div>
          <SearchForm />
        </div>
      </section>

      {/* Value props */}
      <section aria-label="Ưu điểm" className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-3 px-4 py-8 sm:grid-cols-3">
        {[
          { icon: Bus, title: "Chọn ghế trực tiếp", desc: "Sơ đồ ghế thời gian thực, giữ chỗ 10–20 phút." },
          { icon: ShieldCheck, title: "Thanh toán linh hoạt", desc: "COD trên xe, QR chuyển khoản, VNPay." },
          { icon: Clock, title: "Hỗ trợ 24/7", desc: "Chat và gọi thoại trực tiếp với nhà xe." },
        ].map((f) => (
          <Card key={f.title} className="border">
            <CardContent className="flex items-start gap-3 p-4">
              <f.icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <div>
                <p className="font-medium">{f.title}</p>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Recommended trips */}
      {trips.length > 0 && (
        <section aria-labelledby="recs" className="mx-auto w-full max-w-6xl px-4 pb-8">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="size-5 text-primary" aria-hidden />
            <h2 id="recs" className="text-xl font-semibold">Chuyến xe nổi bật</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((t) => (
              <Link key={t.id} href={`/trips/${t.id}`} className="group">
                <Card className="h-full border transition-colors group-hover:border-primary/50">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium leading-snug">{t.route_name}</p>
                        <p className="mt-0.5 text-sm text-muted-foreground">{t.brand_name}</p>
                      </div>
                      {t.vt_label && <Badge variant="secondary">{t.vt_label}</Badge>}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Clock className="size-4" aria-hidden /> {t.departure_time} · {t.departure_date.slice(5).split("-").reverse().join("/")}
                      </span>
                      <span className="font-semibold text-primary">{fmt(t.price)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Còn {t.available_seats} ghế</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Brands */}
      {brands.length > 0 && (
        <section aria-labelledby="brands" className="mx-auto w-full max-w-6xl px-4 pb-12">
          <div className="mb-3 flex items-center gap-2">
            <Star className="size-5 text-primary" aria-hidden />
            <h2 id="brands" className="text-xl font-semibold">Nhà xe uy tín</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {brands.map((b) => (
              <Link key={b.slug} href={`/search?from=&to=&date=`} className="group" aria-label={`Xem chuyến của ${b.name}`}>
                <Card className="h-full border transition-colors group-hover:border-primary/50">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{b.name}</p>
                      {b.rating != null && (
                        <span className="flex items-center gap-1 text-sm text-amber-600">
                          <Star className="size-4 fill-current" aria-hidden /> {b.rating.toFixed(1)}
                        </span>
                      )}
                    </div>
                    {b.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{b.description}</p>
                    )}
                    <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                      <Wifi className="size-3.5" aria-hidden /> {b.total_trips} chuyến đang mở bán
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          <div className="mt-6 text-center">
            <Link href="/support">
              <Button variant="outline">Cần giúp đỡ? Chat với chúng tôi</Button>
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
