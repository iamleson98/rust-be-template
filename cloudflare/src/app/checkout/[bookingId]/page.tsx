"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, fmtVnd, fmtDateLong, type BookingView, type PaymentView } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Banknote, CreditCard, Loader2, QrCode, Ticket, Timer } from "lucide-react";

interface Provider {
  id: "cod" | "vietqr" | "vnpay";
  label: string;
  requiresRedirect: boolean;
}

function VietQrImage({ payload }: { payload: string }) {
  // Render QR via the public qrserver endpoint; payload is EMV text.
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}`;
  return (
    <img src={url} alt="Mã QR chuyển khoản" width={220} height={220} className="rounded-md border" />
  );
}

export default function CheckoutPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [booking, setBooking] = useState<BookingView | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState<string>("cod");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [payment, setPayment] = useState<PaymentView | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<BookingView>(`/api/bookings/${bookingId}`),
      api.get<{ providers: Provider[] }>("/api/payments/providers"),
    ])
      .then(([b, p]) => {
        if (cancelled) return;
        setBooking(b);
        setProviders(p.providers);
        if (p.providers[0]) setProvider(p.providers[0].id);
      })
      .catch((e: Error) => toast({ title: "Lỗi", description: e.message, variant: "destructive" }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [bookingId, toast]);

  async function pay() {
    if (!booking) return;
    setSubmitting(true);
    try {
      const res = await api.post<PaymentView>("/api/payments", {
        bookingId: booking.booking.id,
        provider,
      });
      if (res.gatewayUrl) {
        window.location.href = res.gatewayUrl;
        return;
      }
      setPayment(res);
      toast({ title: "Đã tạo thanh toán", description: "Hoàn tất theo hướng dẫn bên dưới." });
    } catch (e) {
      toast({ title: "Không tạo được thanh toán", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-muted-foreground">Không tìm thấy đơn vé.</p>
        <Link href="/bookings" className="mt-4 inline-block">
          <Button variant="outline">Vé của tôi</Button>
        </Link>
      </div>
    );
  }

  const b = booking.booking;
  const confirmed = b.status === "confirmed";

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="flex items-center gap-2">
        <Ticket className="size-5 text-primary" aria-hidden />
        <h1 className="text-xl font-bold">
          {confirmed ? "Vé đã xác nhận" : "Thanh toán đơn vé"}
        </h1>
        <span className="ml-auto font-mono text-sm text-muted-foreground">{b.code}</span>
      </div>

      {/* Booking summary */}
      <Card className="border">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium">{booking.trip.routeName}</p>
              <p className="text-sm text-muted-foreground">
                {booking.trip.brandName} · {booking.trip.departureTime} · {fmtDateLong(booking.trip.departureDate)}
              </p>
            </div>
            <div className="text-right">
              <BadgeElm status={b.status} />
            </div>
          </div>
          <ul className="space-y-1 border-t pt-3 text-sm">
            {booking.seats.map((s) => (
              <li key={s.seatLabel} className="flex justify-between">
                <span>
                  Ghế <b>{s.seatLabel}</b> · {s.passengerName}
                </span>
                <span>{fmtVnd(s.price)}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t pt-3 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Tạm tính</span>
              <span>{fmtVnd(b.subtotal)}</span>
            </div>
            {b.discount > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Giảm giá</span>
                <span>-{fmtVnd(b.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold">
              <span>Tổng cộng</span>
              <span className="text-primary">{fmtVnd(b.total)}</span>
            </div>
          </div>
          {!confirmed && b.expiresAt && (
            <p className="flex items-center gap-1.5 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
              <Timer className="size-4" aria-hidden /> Ghế được giữ đến{" "}
              {new Date(b.expiresAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </CardContent>
      </Card>

      {confirmed ? (
        <Card className="border">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="font-medium">Thanh toán đã hoàn tất. Chúc bạn có chuyến đi vui vẻ!</p>
            <div className="flex gap-2">
              <Link href="/bookings">
                <Button variant="outline">Vé của tôi</Button>
              </Link>
              <Link href="/">
                <Button>Đặt vé mới</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : payment ? (
        /* Payment created — show instructions */
        <Card className="border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {payment.provider === "vietqr" ? "Chuyển khoản bằng mã QR" : "Thanh toán khi lên xe (COD)"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {payment.qrPayload && (
              <div className="flex flex-col items-center gap-3">
                <VietQrImage payload={payment.qrPayload} />
                <p className="text-center text-sm text-muted-foreground">
                  Quét mã bằng ứng dụng ngân hàng. Nội dung: <b>{payment.memo}</b>
                </p>
              </div>
            )}
            {payment.provider === "cod" && (
              <p className="rounded-md bg-muted p-3 text-sm">
                Vui lòng chuẩn bị <b>{fmtVnd(payment.amount)}</b> tiền mặt. Nhân viên sẽ thu tiền khi bạn lên xe
                và xác nhận vé. Đơn vé sẽ được xác nhận ngay sau khi thu.
              </p>
            )}
            <div className="flex gap-2">
              <Link href={`/bookings/${b.code}`} className="flex-1">
                <Button className="w-full">Xem đơn vé</Button>
              </Link>
              <Button variant="outline" onClick={() => router.refresh()}>
                Làm mới
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* Choose provider */
        <Card className="border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Phương thức thanh toán</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <RadioGroup value={provider} onValueChange={setProvider} className="gap-3">
              {providers.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary"
                >
                  <RadioGroupItem value={p.id} id={`pay-${p.id}`} />
                  {p.id === "cod" && <Banknote className="size-5 text-muted-foreground" aria-hidden />}
                  {p.id === "vietqr" && <QrCode className="size-5 text-muted-foreground" aria-hidden />}
                  {p.id === "vnpay" && <CreditCard className="size-5 text-muted-foreground" aria-hidden />}
                  <div className="flex-1">
                    <Label htmlFor={`pay-${p.id}`} className="cursor-pointer font-normal">
                      {p.label}
                    </Label>
                    {p.id === "cod" && (
                      <p className="text-xs text-muted-foreground">Trả tiền mặt cho nhân viên khi lên xe</p>
                    )}
                  </div>
                </label>
              ))}
              {providers.length === 0 && (
                <p className="text-sm text-muted-foreground">Chưa cấu hình phương thức thanh toán nào.</p>
              )}
            </RadioGroup>
            <Button className="w-full" size="lg" onClick={pay} disabled={submitting || providers.length === 0}>
              {submitting && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
              {fmtVnd(b.total)} — Tiến hành thanh toán
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BadgeElm({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    pending: ["bg-amber-500/15 text-amber-700 border-amber-500/40", "Chờ thanh toán"],
    confirmed: ["bg-emerald-500/15 text-emerald-700 border-emerald-500/40", "Đã xác nhận"],
    cancelled: ["bg-muted text-muted-foreground border-muted", "Đã hủy"],
  };
  const [cls, label] = map[status] ?? ["bg-muted text-muted-foreground border-muted", status];
  return <span className={`rounded-md border px-2 py-1 text-xs font-medium ${cls}`}>{label}</span>;
}
