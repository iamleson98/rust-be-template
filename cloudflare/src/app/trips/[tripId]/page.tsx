"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, fmtVnd, fmtDateLong, type SeatInfo, type TripDetail, type BookingView } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Bus, Check, Clock, Loader2, Users, Wifi } from "lucide-react";

function seatColor(status: string, selected: boolean): string {
  if (selected) return "border-primary bg-primary text-primary-foreground";
  if (status === "available") return "border-muted-foreground/40 bg-background hover:border-primary";
  if (status === "held") return "border-amber-500/60 bg-amber-500/15 text-amber-700 cursor-not-allowed";
  return "border-muted bg-muted text-muted-foreground cursor-not-allowed";
}

export default function TripDetailPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SeatInfo[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [contact, setContact] = useState({ name: "", phone: "", email: "" });
  const [passengerNames, setPassengerNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    api
      .get<TripDetail>(`/api/trips/${tripId}`)
      .then((t) => !cancelled && setTrip(t))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const floors = useMemo(() => {
    if (!trip) return [];
    const set = new Set(trip.seats.map((s) => s.floor));
    return [...set].sort();
  }, [trip]);

  function toggleSeat(seat: SeatInfo) {
    if (seat.status !== "available") return;
    setSelected((cur) =>
      cur.some((s) => s.id === seat.id) ? cur.filter((s) => s.id !== seat.id) : [...cur, seat],
    );
  }

  const total = selected.reduce((sum, s) => sum + s.price, 0);

  async function holdBooking() {
    if (!trip) return;
    if (!contact.name.trim() || !contact.phone.trim()) {
      toast({ title: "Thiếu thông tin", description: "Vui lòng nhập tên và số điện thoại liên hệ." });
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<{ booking: { id: string; code: string } }>("/api/bookings", {
        tripId: trip.id,
        seatIds: selected.map((s) => s.id),
        passengers: selected.map((s) => ({
          name: passengerNames[s.id]?.trim() || contact.name,
          type: "adult" as const,
        })),
        contactName: contact.name,
        contactPhone: contact.phone,
        contactEmail: contact.email || undefined,
      });
      router.push(`/checkout/${res.booking.id}`);
    } catch (e) {
      toast({
        title: "Không giữ được ghế",
        description: e instanceof Error ? e.message : "Ghế vừa có người khác chọn, thử lại.",
      });
      // Refresh seat statuses.
      api.get<TripDetail>(`/api/trips/${tripId}`).then(setTrip).catch(() => {});
      setSelected([]);
      setDialogOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 text-center">
        <p className="text-muted-foreground">{error ?? "Không tìm thấy chuyến xe"}</p>
        <Link href="/" className="mt-4 inline-block">
          <Button variant="outline">Về trang chủ</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Trip summary */}
      <Card className="mb-4 border">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold">{trip.route.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="size-4" aria-hidden /> {trip.departureTime} · {fmtDateLong(trip.departureDate)}
              </span>
              {trip.brand && <span className="flex items-center gap-1"><Bus className="size-4" aria-hidden /> {trip.brand.name}</span>}
              {trip.vehicleType && <Badge variant="secondary">{trip.vehicleType.label}</Badge>}
              <span className="flex items-center gap-1">
                <Users className="size-4" aria-hidden /> {trip.availableSeats}/{trip.totalSeats} ghế trống
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">từ</p>
            <p className="text-2xl font-bold text-primary">{fmtVnd(trip.price.adult)}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Seat map */}
        <Card className="border lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              Chọn ghế
              {trip.amenities.length > 0 && (
                <span className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground">
                  <Wifi className="size-3.5" aria-hidden /> {trip.amenities.join(" · ")}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {!trip.sellWindow.bookable ? (
              <p className="py-8 text-center text-muted-foreground">
                {trip.sellWindow.reason === "departed"
                  ? "Chuyến này đã xuất phát."
                  : "Chuyến này chưa mở bán (chỉ bán trước 14 ngày)."}
              </p>
            ) : (
              floors.map((floor) => (
                <div key={floor} aria-label={`Tầng ${floor}`}>
                  {floors.length > 1 && (
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Tầng {floor}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {trip.seats
                      .filter((s) => s.floor === floor)
                      .map((seat) => {
                        const isSelected = selected.some((s) => s.id === seat.id);
                        return (
                          <button
                            key={seat.id}
                            onClick={() => toggleSeat(seat)}
                            disabled={seat.status !== "available"}
                            className={`flex h-11 w-12 flex-col items-center justify-center rounded-md border text-[10px] leading-tight transition-colors ${seatColor(seat.status, isSelected)}`}
                            aria-label={`Ghế ${seat.label} ${seat.seatClass} ${seat.status}`}
                            aria-pressed={isSelected}
                          >
                            <span className="font-semibold">{seat.label}</span>
                            <span>{seat.status === "available" ? Math.round(seat.price / 1000) + "k" : "—"}</span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))
            )}
            <div className="flex flex-wrap gap-4 border-t pt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded border border-muted-foreground/40 bg-background" /> Trống
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded border border-amber-500/60 bg-amber-500/15" /> Đang giữ
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded border border-muted bg-muted" /> Đã bán
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded border border-primary bg-primary" /> Đang chọn
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Selection summary */}
        <Card className="h-fit border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Ghế đã chọn ({selected.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selected.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chọn ghế trên sơ đồ để tiếp tục.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {selected.map((s) => (
                  <li key={s.id} className="flex items-center justify-between">
                    <span>
                      Ghế <b>{s.label}</b>{" "}
                      <span className="text-xs text-muted-foreground">({s.seatClass})</span>
                    </span>
                    <span className="font-medium">{fmtVnd(s.price)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm text-muted-foreground">Tổng tiền</span>
              <span className="text-lg font-bold text-primary">{fmtVnd(total)}</span>
            </div>
            <Button
              className="w-full"
              size="lg"
              disabled={selected.length === 0 || !trip.sellWindow.bookable}
              onClick={() => setDialogOpen(true)}
            >
              Tiếp tục thanh toán
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Ghế được giữ 10–20 phút sau khi xác nhận.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Booking dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Thông tin hành khách</DialogTitle>
            <DialogDescription>
              {selected.length} ghế · {fmtVnd(total)} — điềm đi {trip.departureTime} {fmtDateLong(trip.departureDate)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="contact-name">Tên người liên hệ *</Label>
                <Input
                  id="contact-name"
                  value={contact.name}
                  onChange={(e) => setContact({ ...contact, name: e.target.value })}
                  placeholder="Nguyễn Văn A"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-phone">Số điện thoại *</Label>
                <Input
                  id="contact-phone"
                  inputMode="tel"
                  value={contact.phone}
                  onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                  placeholder="0901 234 567"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-email">Email (không bắt buộc)</Label>
              <Input
                id="contact-email"
                type="email"
                value={contact.email}
                onChange={(e) => setContact({ ...contact, email: e.target.value })}
                placeholder="ban@email.com"
              />
            </div>
            {selected.map((s) => (
              <div key={s.id} className="space-y-1.5">
                <Label htmlFor={`pax-${s.id}`}>
                  Hành khách ghế {s.label} <span className="text-xs text-muted-foreground">({fmtVnd(s.price)})</span>
                </Label>
                <Input
                  id={`pax-${s.id}`}
                  value={passengerNames[s.id] ?? ""}
                  onChange={(e) => setPassengerNames({ ...passengerNames, [s.id]: e.target.value })}
                  placeholder="Tên hành khách"
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Quay lại
            </Button>
            <Button onClick={holdBooking} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
              Giữ ghế &amp; thanh toán
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
