"use client";

/**
 * A brand's pickup / drop-off locations, managed inside the brand dialog:
 * add, edit (the same map dialog the schedule form creates points with)
 * and delete. Schedules pick their stops from this same list.
 */

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { adminAddressesDeleteMutation, adminAddressesListOptions } from "@spa/api";
import type { AdminAddressOut } from "@spa/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@spa/components/ui/alert-dialog";
import { Button } from "@spa/components/ui/button";
import { Skeleton } from "@spa/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@spa/components/ui/tooltip";
import { Loader2, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@spa/lib/i18n";
import { getErrorMessage } from "@spa/lib/error-message";
import { AddressMapDialog } from "./address-map-dialog";

export function BrandAddressList({ brandId, brandName }: { brandId: string; brandName?: string }) {
  const t = useT();
  const { data, isLoading } = useQuery(adminAddressesListOptions({ query: { brandId } }));
  const items: AdminAddressOut[] = data?.items ?? [];

  // The map dialog: `editing` null adds a new location.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminAddressOut | null>(null);
  const openDialog = (address: AdminAddressOut | null) => {
    setEditing(address);
    setDialogOpen(true);
  };

  const [deleteTarget, setDeleteTarget] = useState<AdminAddressOut | null>(null);
  const deleteMutation = useMutation(adminAddressesDeleteMutation());
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({ path: { id: deleteTarget.id } });
      toast.success(t("adminAddresses.deleted"), { description: deleteTarget.name });
      setDeleteTarget(null);
    } catch (e) {
      const inUse = (e as { error?: unknown } | null)?.error === "conflict";
      toast.error(t("adminAddresses.deleteFailed"), {
        description: inUse ? t("adminAddresses.inUse") : getErrorMessage(e),
      });
    }
  };

  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <MapPin className="h-4 w-4 text-blue-600" /> {t("brandForm.locations")}
            {items.length > 0 ? (
              <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
            ) : null}
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t("brandForm.locationsHint")}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => openDialog(null)}>
          <Plus className="h-4 w-4" /> {t("brandForm.addLocation")}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-16" />
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          {t("brandForm.noLocations")}
        </p>
      ) : (
        // Scrolls on its own: a brand can have many locations. As tall as the
        // brand form beside it from md up, shorter on phones.
        <ul className="max-h-72 divide-y overflow-y-auto overscroll-contain rounded-lg border md:max-h-[26rem]">
          {items.map((a) => {
            const used = a.stopCount ?? 0;
            return (
              <li key={a.id} className="flex items-center gap-2 px-2.5 py-1">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] leading-5 font-medium">{a.name}</div>
                  <div className="truncate text-[11px] leading-4 text-muted-foreground">
                    {a.cityId ? (
                      [a.province, a.district].filter(Boolean).join(" · ")
                    ) : (
                      <span className="text-amber-700">{t("brandForm.locationNoCity")}</span>
                    )}
                    {used > 0 ? <> · {t("brandForm.locationStops", { count: used })}</> : null}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label={t("brandForm.editLocation", { name: a.name })}
                  onClick={() => openDialog(a)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {used > 0 ? (
                  // A location schedules stop at stays: deleting it would drop those stops.
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        aria-label={t("adminAddresses.inUse")}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground/40" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t("adminAddresses.inUse")}</TooltipContent>
                  </Tooltip>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    aria-label={t("brandForm.deleteLocation", { name: a.name })}
                    onClick={() => setDeleteTarget(a)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <AddressMapDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        brandId={brandId}
        brandName={brandName}
        address={editing}
        onSaved={() => setEditing(null)}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!deleteMutation.isPending && !open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("brandForm.deleteLocationQ")}{" "}
              <span className="font-semibold text-foreground">{deleteTarget?.name}</span>?{" "}
              {t("common.confirmDeleteBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleteMutation.isPending}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {t("common.deleting")}
                </>
              ) : (
                <>
                  <Trash2 className="mr-1.5 h-4 w-4" /> {t("common.delete")}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
