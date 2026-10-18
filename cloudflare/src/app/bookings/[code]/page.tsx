"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, fmtVnd, fmtDateLong, type BookingView, type PaymentView } from "@/lib/client";
import { StatusBadge } from "../page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Printer, XCircle } from "lucide-react";

export default function BookingDetailPage() {
  const { code } = useParams<{ code: string }>();
  const { toast } = useToast();
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [payments, setPayments] = useState<PaymentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<BookingView>(`/api/bookings/${code}`),
      api.get<{ items: PaymentView[] }>(`/api/payments/booking/${code}`).catch(() => ({ items: [] as PaymentView[] })),
    ])
      .then(([b, p]) => {
        if (cancelled) return;
        setBooking(b);
        setPayments(p.items);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function cancel() {
    if (!booking) return;
    setCancelling(true);
    try {
      await api.post(`/api/bookings/${code}/cancel`);
      toast({ title: "Đã hủy vé" });
      const b = await api.get<BookingView>(`/api/bookings/${code}`);
      setBooking(b);
    } catch (e) {
      toast({ title: "Không hủy được", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-6">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-muted-foreground">Không tìm thấy vé.</p>
        <Link href="/bookings" className="mt-4 inline-block">
          <Button variant="outline">Vé của tôi</Button>
        </Link>
      </div>
    );
  }

  const b = booking.booking;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <Card className="border">
        <CardContent className="space-y-4 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">Vé {b.code}</h1>
            <StatusBadge status={b.status} />
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto"
              onClick={() => window.print()}
              aria-label="In vé"
            >
              <Printer className="size-4" />
            </Button>
          </div>

          <div className="rounded-lg border p-4">
            <p className="font-medium">{booking.trip.routeName}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {booking.trip.brandName} · Xuất phát {booking.trip.departureTime} ·{" "}
              {fmtDateLong(booking.trip.departureDate)}
            </p>
          </div>

          <ul className="space-y-2 text-sm">
            {booking.seats.map((s) => (
              <li key={s.seatLabel} className="flex justify-between border-b pb-2 last:border-0">
                <span>
                  Ghế <b>{s.seatLabel}</b> · {s.passengerName}
                </span>
                <span>{fmtVnd(s.price)}</span>
              </li>
            ))}
          </ul>

          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Tạm tính</span>
              <span>{fmtVnd(b.subtotal)}</span>
            </div>
            <div className="flex justify-between text-base font-bold">
              <span>Tổng cộng</span>
              <span className="text-primary">{fmtVnd(b.total)}</span>
            </div>
          </div>

          {b.contactName && (
            <p className="text-sm text-muted-foreground">
              Người liên hệ: <b>{b.contactName}</b> · {b.contactPhone}
            </p>
          )}

          {payments.length > 0 && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <p className="mb-1 font-medium">Thanh toán</p>
              {payments.map((p) => (
                <p key={p.id} className="flex justify-between text-muted-foreground">
                  <span>
                    {p.provider.toUpperCase()} ·{" "}
                    {p.status === "completed"
                      ? "hoàn tất"
                      : p.status === "pending"
                        ? "đang chờ"
                        : p.status === "refunded"
                          ? "đã hoàn tiền"
                          : p.status}
                  </span>
                  <span>{fmtVnd(p.amount)}</span>
                </p>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {b.status === "pending" && (
              <Link href={`/checkout/${b.id}`}>
                <Button>Tiến hành thanh toán</Button>
              </Link>
            )}
            {(b.status === "pending" || b.status === "confirmed") && (
              <Button variant="outline" onClick={cancel} disabled={cancelling}>
                <XCircle className="mr-2 size-4" aria-hidden /> Hủy vé
              </Button>
            )}
            <Link href="/bookings">
              <Button variant="ghost">Vé của tôi</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
