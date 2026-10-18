"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, fmtVnd, fmtDateLong, type BookingView } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Ticket, Clock, ArrowRight } from "lucide-react";

interface BookingListItem {
  id: string;
  code: string;
  status: string;
  total: number;
  tripSessionId: string;
  createdAt: string;
  expiresAt: string | null;
  paymentMethod: string | null;
}

export default function BookingsPage() {
  const [items, setItems] = useState<BookingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ items: BookingListItem[] }>("/api/bookings")
      .then((d) => !cancelled && setItems(d.items))
      .catch((e: { status?: number }) => {
        if (e.status === 401) setUnauthorized(true);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-muted-foreground">Đăng nhập để xem vé của bạn.</p>
        <Link href="/login" className="mt-4 inline-block">
          <Button>Đăng nhập</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center gap-2">
        <Ticket className="size-5 text-primary" aria-hidden />
        <h1 className="text-xl font-bold">Vé của tôi</h1>
      </div>

      {items.length === 0 && (
        <Card className="border">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <p className="text-muted-foreground">Bạn chưa có vé nào.</p>
            <Link href="/">
              <Button>Đặt vé ngay</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {items.map((b) => (
          <Link key={b.id} href={`/bookings/${b.code}`} className="block" aria-label={`Xem vé ${b.code}`}>
            <Card className="border transition-colors hover:border-primary/50">
              <CardContent className="flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">{b.code}</span>
                    <StatusBadge status={b.status} />
                  </div>
                  <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                    <Clock className="size-3.5" aria-hidden /> Đặt {fmtDateLong(b.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-primary">{fmtVnd(b.total)}</span>
                  <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    pending: ["bg-amber-500/15 text-amber-700", "Chờ thanh toán"],
    confirmed: ["bg-emerald-500/15 text-emerald-700", "Đã xác nhận"],
    cancelled: ["bg-muted text-muted-foreground", "Đã hủy"],
  };
  const [cls, label] = map[status] ?? ["bg-muted text-muted-foreground", status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
