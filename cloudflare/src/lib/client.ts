"use client";

/** Client-side API helpers — cookie-auth fetch + typed wrappers. */

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit, isRetry = false): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    credentials: "same-origin",
  });
  // Access token expired → rotate the refresh cookie once, then retry.
  if (res.status === 401 && !isRetry && !path.includes("/api/auth/")) {
    const refreshed = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
    });
    if (refreshed.ok) return req<T>(path, init, true);
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } }).error;
    throw new ApiClientError(res.status, err?.code ?? "error", err?.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => req<T>(path),
  post: <T>(path: string, data?: unknown) =>
    req<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) }),
  put: <T>(path: string, data?: unknown) =>
    req<T>(path, { method: "PUT", body: data === undefined ? undefined : JSON.stringify(data) }),
  del: <T>(path: string) => req<T>(path, { method: "DELETE" }),
  upload: async <T>(path: string, form: FormData) => {
    const res = await fetch(path, { method: "POST", body: form, credentials: "same-origin" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? "Upload failed");
    return body as T;
  },
};

// ── Shared types (mirror the API responses) ─────────────────────────

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: string;
  avatarUrl?: string | null;
}

export interface PlaceHit {
  id: string;
  name: string;
  nameNoTones: string | null;
  type: string;
  province: string | null;
  district: string | null;
  lat: number;
  lon: number;
}

export interface TripItem {
  id: string;
  departureDate: string;
  departureTime: string;
  status: string;
  totalSeats: number;
  availableSeats: number;
  route: { id: string; name: string; from: string; to: string };
  brand: { id: string; slug: string; name: string; logoUrl: string | null; rating: number | null } | null;
  vehicleType: { code: string; label: string } | null;
  amenities: string[];
  price: { adult: number; child: number | null; currency: string };
}

export interface SeatInfo {
  id: string;
  label: string;
  seatClass: string;
  row: number | null;
  col: number | null;
  isWindow: boolean;
  floor: number;
  status: string;
  price: number;
}

export interface TripDetail extends TripItem {
  seats: SeatInfo[];
  fares: { seatClass: string; adult: number; child: number | null }[];
  boardingPoints: { id: string; name: string; address: string | null }[];
  droppingPoints: { id: string; name: string; address: string | null }[];
  sellWindow: { bookable: boolean; reason?: string };
}

export interface BookingView {
  booking: {
    id: string;
    code: string;
    status: string;
    subtotal: number;
    discount: number;
    fees: number;
    total: number;
    expiresAt: string | null;
    contactName: string | null;
    contactPhone: string | null;
    paymentMethod: string | null;
    createdAt: string;
  };
  seats: { seatLabel: string; seatClass: string | null; passengerName: string | null; price: number }[];
  trip: { id: string; departureDate: string; departureTime: string; routeName: string; brandName: string | null };
}

export interface PaymentView {
  id: string;
  provider: string;
  status: string;
  amount: number;
  currency: string;
  gatewayUrl: string | null;
  qrPayload: string | null;
  memo: string | null;
  booking?: { id: string; code: string; status: string } | null;
}

export interface ChatMessageView {
  id: string;
  channelId: string;
  senderType: "user" | "employee" | "assistant" | "system";
  senderId: string | null;
  content: string | null;
  kind: string;
  clientMsgId: string | null;
  createdAt: string;
}

export interface ChatChannelView {
  id: string;
  topic: string | null;
  status: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unread: number;
  createdAt: string;
  customerName: string;
}

// ── Formatting helpers ──────────────────────────────────────────────

export function fmtVnd(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("vi-VN").replace(/,/g, ".") + "₫";
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00`);
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtDateLong(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00`);
  return d.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

export function cityLabel(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
