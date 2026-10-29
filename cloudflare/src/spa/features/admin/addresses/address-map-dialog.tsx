import { adminAddressesCreateMutation, adminAddressesUpdateMutation } from "@spa/api";
import { useMutation } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@spa/components/ui/dialog";
import { Button } from "@spa/components/ui/button";
import { Input } from "@spa/components/ui/input";
import { Label } from "@spa/components/ui/label";
import { ComboboxField } from "@spa/components/ui/combobox";
import { MapPin, Loader2, Plus, Search, X, Crosshair, Check } from "lucide-react";
import { toast } from "sonner";
import { usePlaceSearch } from "@spa/features/map/api";
import { useT } from "@spa/lib/i18n";
import { reverseGeocode } from "@spa/features/map/leaflet-map";
import { useMyLocation } from "@spa/features/map/use-my-location";
import type { AdminAddressOut, PlaceSearchHit } from "@spa/api";
import { LatLongRegex, parseLatLong } from "./lat-long";
import { getErrorMessage } from "@spa/lib/error-message";
import { cityForProvince } from "@/lib/city-match";
import { cityLabel, getCityGroups } from "@spa/features/admin/routes/city-select-content";

const LeafletMap = lazy(() =>
  import("@spa/features/map/leaflet-map").then((m) => ({ default: m.LeafletMap })),
);

const MapFallback = (
  <div className="flex h-full items-center justify-center text-muted-foreground">
    <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
  </div>
);

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The brand the new address will belong to (each address belongs to exactly 1 brand). */
  brandId?: string;
  brandName?: string;
  /** The address to edit; none creates a new one. */
  address?: AdminAddressOut | null;
  /** Fired after a successful save with the address as saved. */
  onSaved: (address: AdminAddressOut) => void;
};

type FormState = {
  name: string;
  address: string;
  /** Slug of one of our cities; required. */
  cityId: string;
  district: string;
  ward: string;
  lat: number | null;
  lon: number | null;
};

const EMPTY_FORM: FormState = {
  name: "",
  address: "",
  cityId: "",
  district: "",
  ward: "",
  lat: null,
  lon: null,
};

/** The form for an existing address; a point older than the city field gets its province's city. */
const formOf = (a: AdminAddressOut): FormState => ({
  name: a.name,
  address: a.address ?? "",
  cityId: a.cityId ?? cityForProvince(a.province) ?? "",
  district: a.district ?? "",
  ward: a.ward ?? "",
  lat: a.lat,
  lon: a.lon,
});

export function AddressMapDialog({
  open,
  onOpenChange,
  brandId,
  brandName,
  address: editing,
  onSaved,
}: Props) {
  const t = useT();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [picked, setPicked] = useState<{ name: string; lat: number; lon: number } | null>(null);
  const [reverseLoading, setReverseLoading] = useState(false);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  // A city staff chose themselves stays; otherwise it follows the picked point.
  const cityByHand = useRef(false);
  /** The picked place's province when it is none of our cities. */
  const [unmatchedProvince, setUnmatchedProvince] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const cityGroups = getCityGroups(t);

  /** Fills the city from the picked place's province, unless staff chose one. */
  const fillCity = useCallback((province: string | null | undefined) => {
    if (cityByHand.current) return;
    const cityId = cityForProvince(province);
    setForm((f) => ({ ...f, cityId: cityId ?? "" }));
    setUnmatchedProvince(cityId ? null : province?.trim() || null);
  }, []);

  // Place search for the overlay box; `debounced` drives the lat/long parse.
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const result = parseLatLong(debounced);
    if (result.ok) {
      // Intentional effect-synced state (dialog reset-on-open /
      // server-data snapshot / DOM-availability gate).

      setReverseLoading(true);

      reverseGeocode(result.value![0], result.value![1])
        .then(({ name, lat, lon, province, district }) => {
          setPicked({ name, lat, lon });
          setForm((f) => ({
            ...f,
            name: f.name.trim() ? f.name : name,
            district: f.district.trim() ? f.district : (district ?? ""),
            lat,
            lon,
          }));
          fillCity(province);
        })
        .finally(() => setReverseLoading(false));
    }

    // return null;
  }, [debounced, fillCity]);

  // The hook debounces on its own, so it takes the raw input.
  const { data: searchData, isLoading: searchLoading } = usePlaceSearch(query, {
    enabled: open && query.trim().length >= 2 && !LatLongRegex.test(query),
    limit: 20,
  });
  const hits: PlaceSearchHit[] = searchData?.items ?? [];

  const createMutation = useMutation(adminAddressesCreateMutation());
  const updateMutation = useMutation(adminAddressesUpdateMutation());
  const saving = createMutation.isPending || updateMutation.isPending;

  // Reset every time the dialog opens.
  useEffect(() => {
    if (open) {
      // Intentional effect-synced state (dialog reset-on-open /
      // server-data snapshot / DOM-availability gate).

      setForm(editing ? formOf(editing) : EMPTY_FORM);
      cityByHand.current = false;
      setUnmatchedProvince(null);
      setSubmitted(false);
      setPicked(editing ? { name: editing.name, lat: editing.lat, lon: editing.lon } : null);
      setFlyTarget(editing ? [editing.lat, editing.lon] : null);
      setQuery("");
      setDebounced("");
      setSearchOpen(false);
    }
  }, [open, editing]);

  // Close the search dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  /** GPS "my location" — progressive-accuracy acquisition via the shared
   *  useMyLocation hook (same fix as the customer MapPicker: the old
   *  one-shot getCurrentPosition frequently returned coarse Wi-Fi/cell
   *  fixes hundreds of meters off, and silently swallowed errors).
   *  Results arrive via ref-backed callbacks, so the fresh translator
   *  closure each render can never re-trigger the fix handler.
   *
   *  `handleMapClick` (defined below, after the hook — it needs the
   *  hook's `cancel`) is reached through a ref so the accepted fix can
   * reuse the reverse-geocode + form-prefill pipeline. */
  const handleMapClickRef = useRef<(lat: number, lon: number) => Promise<void>>(async () => {});

  const handleLocated = useCallback(
    (loc: { lat: number; lon: number; accuracy: number }) => {
      if (Number.isFinite(loc.accuracy) && loc.accuracy > 1000) {
        toast.warning(t("mapPage.lowAccuracy", { m: Math.round(loc.accuracy) }));
      }
      setFlyTarget([loc.lat, loc.lon]);
      void handleMapClickRef.current(loc.lat, loc.lon);
    },
    [t],
  );

  const handleLocateError = useCallback(
    (code: "unavailable" | "denied" | "timeout") => {
      toast.error(
        code === "unavailable"
          ? t("mapPage.noGeolocation")
          : code === "denied"
            ? t("mapPage.locationDenied")
            : t("map.cannotLocate"),
      );
    },
    [t],
  );

  const {
    acquiring: gpsAcquiring,
    locate: locateMe,
    cancel: cancelLocate,
  } = useMyLocation(handleLocated, handleLocateError);

  /** Map click → exact lat/lon + reverse-geocoded display name (never moves the pin). */
  const handleMapClick = useCallback(
    async (lat: number, lon: number) => {
      // Manual pick — void any in-flight GPS acquisition so a late fix
      // can't clobber the user's explicit choice.
      cancelLocate();
      setForm((f) => ({ ...f, lat, lon }));
      setPicked({ name: t("adminAddresses.lookingUp"), lat, lon });
      setReverseLoading(true);
      const place = await reverseGeocode(lat, lon);
      setReverseLoading(false);
      setPicked({ name: place.name, lat, lon });
      setForm((f) => ({
        ...f,
        // Pre-fill name/hierarchy only when still empty — never clobber
        // what the user already typed.
        name: f.name.trim() ? f.name : place.name,
      }));
      fillCity(place.province);
    },
    [t, cancelLocate, fillCity],
  );

  // Keep the GPS-fix pipeline ref pointed at the latest map-click handler
  // (its identity changes with the translator; GPS fixes are async so the
  // ref is always current by the time a fix arrives).
  useEffect(() => {
    handleMapClickRef.current = handleMapClick;
  }, [handleMapClick]);

  /** Search result click → drop the marker on the result + prefill the form. */
  const handleSearchSelect = useCallback(
    (hit: PlaceSearchHit) => {
      if (hit.lat == null || hit.lon == null) return;
      cancelLocate();
      const lat = hit.lat;
      const lon = hit.lon;
      setForm((f) => ({
        ...f,
        lat,
        lon,
        name: f.name.trim() ? f.name : hit.name,
        district: f.district.trim() ? f.district : (hit.district ?? ""),
        ward: f.ward.trim() ? f.ward : (hit.ward ?? ""),
      }));
      fillCity(hit.province);
      setPicked({ name: hit.name, lat, lon });
      setFlyTarget([lat, lon]);
      setSearchOpen(false);
      setQuery(hit.name ?? "");
    },
    [cancelLocate, fillCity],
  );

  const onInput = (v: string) => {
    setQuery(v);
    setSearchOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebounced(v), 300);
  };

  const handleSave = async () => {
    if (!brandId) {
      toast.error(t("adminAddresses.noBrandForAddress"));
      return;
    }
    if (!form.name.trim()) {
      toast.error(t("adminAddresses.nameRequired"));
      return;
    }
    if (form.lat == null || form.lon == null) {
      toast.error(t("adminAddresses.positionRequired"));
      return;
    }
    if (!form.cityId) {
      setSubmitted(true);
      return;
    }
    const fields = {
      name: form.name.trim(),
      address: form.address.trim() || null,
      lat: form.lat,
      lon: form.lon,
      cityId: form.cityId,
      district: form.district.trim() || null,
      ward: form.ward.trim() || null,
    };
    try {
      let id: string;
      if (editing) {
        await updateMutation.mutateAsync({ path: { id: editing.id }, body: fields });
        id = editing.id;
      } else {
        // SDK mutation hooks require { body: <payload> } — see the 415 note
        // in queries/index.ts.
        const res = (await createMutation.mutateAsync({ body: { brandId, ...fields } })) as {
          id?: string;
          data?: { id?: string };
        };
        const newId = res?.id ?? res?.data?.id;
        if (!newId) throw new Error("missing id in response");
        id = newId;
      }
      toast.success(t(editing ? "adminAddresses.updated" : "adminAddresses.created"), {
        description: fields.name,
      });
      const now = new Date().toISOString();
      onSaved({
        ...fields,
        id,
        brandId,
        province: cityLabel(form.cityId),
        createdAt: editing?.createdAt ?? now,
        updatedAt: now,
      });
      onOpenChange(false);
    } catch (e) {
      toast.error(t(editing ? "adminAddresses.updateFailed" : "adminAddresses.createFailed"), {
        description: getErrorMessage(e, t("adminAddresses.tryAgain")),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      {/* max-h + internal scroll — previously unbounded: the stacked
          mobile layout (form + 420px map + footer) ran ~1100px tall, so
          the Save/Cancel footer was unreachable on phones. */}
      <DialogContent className="max-w-4xl max-h-[92dvh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader icon={<MapPin />} className="shrink-0 border-b px-5 py-4 pr-14">
          <DialogTitle>
            {t(editing ? "adminAddresses.editTitle" : "adminAddresses.createTitle")}
            {brandName ? (
              <span className="ml-1 text-xs font-normal text-muted-foreground">· {brandName}</span>
            ) : null}
          </DialogTitle>
          <DialogDescription>{t("adminAddresses.createDesc")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr] flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {/* ── Form ──────────────────────────────────────────── */}
          <div className="p-5 space-y-4 md:border-r">
            <div className="grid gap-1.5">
              <Label htmlFor="addr-name">
                {t("adminAddresses.name")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="addr-name"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder={t("adminAddresses.namePh")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="addr-detail">{t("adminAddresses.detailLabel")}</Label>
              <Input
                id="addr-detail"
                value={form.address}
                onChange={(e) => update("address", e.target.value)}
                placeholder={t("adminAddresses.detailPh")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>
                {t("adminAddresses.provinceLabel")} <span className="text-destructive">*</span>
              </Label>
              <ComboboxField
                value={form.cityId || null}
                onValueChange={(cityId) => {
                  cityByHand.current = cityId !== "";
                  update("cityId", cityId);
                }}
                items={cityGroups}
                placeholder={t("adminAddresses.cityPh")}
                searchPlaceholder={t("routeForm.searchCity")}
                aria-label={t("adminAddresses.provinceLabel")}
                className={submitted && !form.cityId ? "border-destructive" : undefined}
              />
              {submitted && !form.cityId ? (
                <p className="text-xs text-destructive">{t("adminAddresses.cityRequired")}</p>
              ) : unmatchedProvince && !form.cityId ? (
                <p className="text-xs text-muted-foreground">
                  {t("adminAddresses.cityUnmatched", { province: unmatchedProvince })}
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="addr-district">{t("adminAddresses.districtLabel")}</Label>
                <Input
                  id="addr-district"
                  value={form.district}
                  onChange={(e) => update("district", e.target.value)}
                  placeholder="Nam Từ Liêm"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="addr-ward">{t("adminAddresses.wardLabel")}</Label>
                <Input
                  id="addr-ward"
                  value={form.ward}
                  onChange={(e) => update("ward", e.target.value)}
                  placeholder="Mỹ Đình 1"
                />
              </div>
            </div>

            {/* Coordinates — filled by the map / search; read-only UI. */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>{t("adminAddresses.latLabel")}</Label>
                <Input
                  readOnly
                  tabIndex={-1}
                  value={form.lat != null ? form.lat.toFixed(6) : ""}
                  placeholder={t("adminAddresses.autoFromMap")}
                  className="font-mono text-base md:text-xs bg-muted/40"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("adminAddresses.lonLabel")}</Label>
                <Input
                  readOnly
                  tabIndex={-1}
                  value={form.lon != null ? form.lon.toFixed(6) : ""}
                  placeholder={t("adminAddresses.autoFromMap")}
                  className="font-mono text-base md:text-xs bg-muted/40"
                />
              </div>
            </div>
          </div>

          {/* ── Map + search overlay ──────────────────────────── */}
          <div className="relative h-[45dvh] md:h-auto md:min-h-120 bg-slate-100">
            <Suspense fallback={MapFallback}>
              <LeafletMap
                className="h-full w-full"
                initialZoom={6}
                marker={picked ? { lat: picked.lat, lon: picked.lon } : null}
                onMapClick={handleMapClick}
                flyTarget={flyTarget}
                flyZoom={13}
              />
            </Suspense>

            {/* Full-text search overlay */}
            <div
              ref={searchBoxRef}
              className="absolute left-3 top-3 z-1000 w-[min(20rem,calc(100%-1.5rem))]"
            >
              <div className="relative">
                {/* z-10: the input after it would otherwise paint over it. */}
                <Search className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-slate-500" />
                <input
                  value={query}
                  onChange={(e) => onInput(e.target.value)}
                  onFocus={() => setSearchOpen(true)}
                  placeholder={t("map.searchField")}
                  className="h-10 w-full rounded-xl bg-white pr-9 pl-10 text-base shadow-float ring-1 ring-slate-900/10 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-primary/40 md:text-sm"
                />
                {searchLoading ? (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-blue-600" />
                ) : query ? (
                  <button
                    type="button"
                    aria-label={t("map.clearSearch")}
                    onClick={() => {
                      setQuery("");
                      setDebounced("");
                      setSearchOpen(false);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              {searchOpen && debounced.trim().length >= 2 && (
                <div className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  {hits.length === 0 && !searchLoading ? (
                    <div className="px-3 py-2.5 text-xs text-muted-foreground">
                      {t("map.noResults")}
                    </div>
                  ) : (
                    <ul>
                      {hits.map((h, i) => (
                        <li key={h.id ?? h.osmId ?? i}>
                          <button
                            type="button"
                            onClick={() => handleSearchSelect(h)}
                            className="flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm hover:bg-blue-50 transition-colors"
                          >
                            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                            <span className="line-clamp-2 text-foreground">
                              {h.name}
                              {h.province ? (
                                <span className="text-muted-foreground">, {h.province}</span>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* GPS button — spinner while acquiring (see useMyLocation). */}
            <button
              type="button"
              onClick={locateMe}
              disabled={gpsAcquiring}
              className="absolute right-3 top-3 z-1000 h-10 w-10 rounded-lg bg-white/95 backdrop-blur ring-1 ring-slate-200 flex items-center justify-center text-blue-600 hover:bg-blue-50 disabled:cursor-wait transition-colors"
              title={gpsAcquiring ? t("mapPage.locating") : t("map.myLocation")}
              aria-label={gpsAcquiring ? t("mapPage.locating") : t("map.myLocation")}
            >
              {gpsAcquiring ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Crosshair className="h-5 w-5" />
              )}
            </button>

            {/* Hint pill before the first pick */}
            {!picked && (
              <div className="pointer-events-none absolute bottom-14 left-1/2 -translate-x-1/2 z-1000 rounded-full bg-slate-900/80 backdrop-blur px-4 py-2 text-xs font-medium text-white">
                <MapPin className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
                {t("map.clickToPick")}
              </div>
            )}

            {/* Picked-location pill (bottom-left) */}
            {picked && (
              <div className="absolute bottom-14 left-3 z-1000 max-w-[min(22rem,calc(100%-1.5rem))] rounded-lg bg-white/95 backdrop-blur border border-slate-200 px-3 py-2 flex items-center gap-2">
                {reverseLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600 shrink-0" />
                ) : (
                  <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate text-foreground">{picked.name}</div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    {picked.lat.toFixed(4)}, {picked.lon.toFixed(4)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="px-5 py-4 border-t bg-white">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              saving || !form.name.trim() || form.lat == null || form.lon == null || !brandId
            }
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> {t("common.saving")}
              </>
            ) : editing ? (
              t("common.saveChanges")
            ) : (
              <>
                <Plus className="h-4 w-4 mr-1.5" /> {t("adminAddresses.createBtn")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
