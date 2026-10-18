import { redirect } from "next/navigation";
import { currentUserFromCookies } from "@/lib/auth/server";
import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Ticket, Trophy, User } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await currentUserFromCookies();
  if (!user) redirect("/login");

  const bookings = await rawAll<{ status: string; n: number }>(
    sql`SELECT status, COUNT(*) AS n FROM booking WHERE user_id = ${user.id} GROUP BY status`,
  );
  const loyaltyRows = await rawAll<{ total: number }>(
    sql`SELECT COALESCE(SUM(total), 0) AS total FROM booking WHERE user_id = ${user.id} AND status = 'confirmed'`,
  );
  const spent = Number(loyaltyRows[0]?.total ?? 0);
  const points = Math.floor(spent / 10000);
  const tier =
    points >= 20000 ? "Platinum" : points >= 5000 ? "Gold" : points >= 1000 ? "Silver" : "Bronze";
  const counts: Record<string, number> = { pending: 0, confirmed: 0, cancelled: 0 };
  for (const r of bookings) counts[r.status] = Number(r.n);

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
          <User className="size-6 text-primary" aria-hidden />
        </div>
        <div>
          <h1 className="text-xl font-bold">{user.fullName}</h1>
          <p className="text-sm text-muted-foreground">{user.email || user.phone}</p>
        </div>
        <Badge className="ml-auto capitalize" variant="secondary">
          {user.role}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="border">
          <CardContent className="p-4">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Ticket className="size-4" aria-hidden /> Vé đã xác nhận
            </p>
            <p className="mt-1 text-2xl font-bold">{counts.confirmed ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="border">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Đang chờ thanh toán</p>
            <p className="mt-1 text-2xl font-bold">{counts.pending ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="border">
          <CardContent className="p-4">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Trophy className="size-4" aria-hidden /> Điểm thưởng
            </p>
            <p className="mt-1 text-2xl font-bold">
              {points.toLocaleString("vi-VN")}{" "}
              <span className="text-sm font-normal text-muted-foreground">({tier})</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tiện ích</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-sm">
          <a href="/bookings" className="rounded-md border px-3 py-2 hover:bg-accent">Vé của tôi</a>
          <a href="/support" className="rounded-md border px-3 py-2 hover:bg-accent">Hỗ trợ trực tuyến</a>
        </CardContent>
      </Card>
    </div>
  );
}
