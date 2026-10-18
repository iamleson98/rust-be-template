"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, type PlaceHit } from "@/lib/client";
import { ArrowLeftRight, Calendar, MapPin, Search } from "lucide-react";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function PlaceInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (name: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PlaceHit[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!open || query.trim().length < 1) return;
    timer.current = setTimeout(async () => {
      try {
        const res = await api.get<{ items: PlaceHit[] }>(
          `/api/places/search?q=${encodeURIComponent(query)}&limit=8`,
        );
        setItems(res.items);
      } catch {
        setItems([]);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, open]);

  return (
    <div className="flex-1 space-y-1">
      <Label htmlFor={`place-${label}`} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={`place-${label}`}
            variant="outline"
            role="combobox"
            className="h-11 w-full justify-start gap-2 font-normal"
          >
            <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{value || placeholder}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <div className="p-2">
            <Input
              autoFocus
              placeholder="Tìm thành phố, quận, điểm đón…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={`Tìm ${label}`}
            />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {items.map((p) => (
              <button
                key={p.id}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onChange(p.name);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground">
                  {[p.type === "city" ? "Thành phố" : p.type === "district" ? "Quận/Huyện" : p.district ?? p.type, p.province]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </button>
            ))}
            {query && items.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Không tìm thấy địa điểm</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Slugify a place name to a city slug for search (matches route endpoint ids). */
function toSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function SearchForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!from || !to) {
      setError("Vui lòng chọn điểm đi và điểm đến");
      return;
    }
    setError(null);
    router.push(`/search?from=${encodeURIComponent(toSlug(from))}&to=${encodeURIComponent(toSlug(to))}&date=${date}`);
  }

  return (
    <form
      onSubmit={submit}
      className={`flex w-full flex-col gap-3 rounded-xl border bg-card p-4 ${compact ? "" : "sm:p-5"}`}
      aria-label="Tìm chuyến xe"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <PlaceInput label="Điểm đi" value={from} onChange={setFrom} placeholder="VD: Hà Nội" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mx-auto hidden size-9 shrink-0 sm:flex"
          aria-label="Đảo chiều điểm đi/đến"
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
        >
          <ArrowLeftRight className="size-4" />
        </Button>
        <PlaceInput label="Điểm đến" value={to} onChange={setTo} placeholder="VD: Đà Nẵng" />
        <div className="flex-1 space-y-1">
          <Label htmlFor="search-date" className="text-xs text-muted-foreground">
            Ngày đi
          </Label>
          <div className="relative">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="search-date"
              type="date"
              value={date}
              min={todayIso()}
              onChange={(e) => setDate(e.target.value)}
              className="h-11 pl-9"
            />
          </div>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" className="w-full sm:w-auto sm:self-end sm:px-8">
        <Search className="mr-2 size-4" aria-hidden /> Tìm chuyến xe
      </Button>
    </form>
  );
}
