'use client'

/**
 * RoutePickupPointsDialog — manages one route's pickup/drop points
 * inside a single modal (opened from the brands tree's route-row
 * "Điểm đón/trả" action).
 *
 * Lists the ordered points (stop-order chips + type badges), with
 * add/edit via the shared PickupPointFormDialog and delete behind a
 * confirm. Replaces the inline pickup list the legacy 3-panel
 * brands page had in its detail column.
 */

import { useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  useAdminPickupPoints,
  useDeleteAdminPickupPoint,
  usePlacesList,
} from '@/lib/queries'
import type { AdminPickupPointOut, AdminRouteOut } from '@/lib/api/types.gen'
import { PICKUP_TYPE_LABELS } from '@/features/admin/types'
import { PickupPointFormDialog } from '@/features/admin/pickup-points/pickup-form'
import { getErrorMessage } from '@/lib/error-message'

export function RoutePickupPointsDialog({
  route,
  onOpenChange,
}: {
  route: AdminRouteOut | null
  onOpenChange: (open: boolean) => void
}) {
  const open = !!route
  const routeId = route?.id
  const pickupQuery = useAdminPickupPoints(routeId)
  const placesQuery = usePlacesList(200)
  const deleteMutation = useDeleteAdminPickupPoint()

  const pickupPoints = useMemo(
    () => [...(pickupQuery.data?.items ?? [])].sort((a, b) => a.stopOrder - b.stopOrder),
    [pickupQuery.data],
  )
  const places = (((placesQuery.data ?? {}) as { items?: unknown[] }).items ?? []) as never[]

  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AdminPickupPointOut | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminPickupPointOut | null>(null)
  const [deleting, setDeleting] = useState(false)

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteMutation.mutateAsync({ path: { id: deleteTarget.id } })
      toast.success('Đã xoá điểm đón/trả')
      setDeleteTarget(null)
    } catch (e) {
      toast.error(getErrorMessage(e, 'Không thể xoá điểm đón/trả'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !deleting && onOpenChange(o)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4 text-rose-600" />
              Điểm đón / trả
            </DialogTitle>
            <DialogDescription className="truncate">
              {route ? `${route.name} · ${route.startLocation?.name ?? ''} → ${route.endLocation?.name ?? ''}` : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-end">
            <Button
              size="sm"
              className="h-7 gap-1"
              onClick={() => {
                setEditTarget(null)
                setFormOpen(true)
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Thêm điểm
            </Button>
          </div>

          {pickupQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> Đang tải điểm đón/trả…
            </div>
          ) : pickupPoints.length === 0 ? (
            <div className="rounded-md border border-dashed py-8 text-center text-xs text-muted-foreground">
              Tuyến chưa có điểm đón/trả nào.
            </div>
          ) : (
            <div className="space-y-1.5">
              {pickupPoints.map((p) => (
                <div
                  key={p.id}
                  className="flex items-start gap-2 rounded-lg border p-2.5"
                  data-testid={`pickup-row-${p.id}`}
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-100 text-[10px] font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                    {p.stopOrder}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{p.name}</span>
                      <Badge
                        variant="outline"
                        className={`h-4 px-1 text-[9px] ${
                          p.kind === 'station'
                            ? 'bg-blue-50 text-blue-700'
                            : p.kind === 'curb'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {PICKUP_TYPE_LABELS[p.kind ?? ''] ?? p.kind}
                      </Badge>
                    </div>
                    {p.address && (
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{p.address}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setEditTarget(p)
                        setFormOpen(true)
                      }}
                      className="rounded p-1 text-slate-400 transition-colors hover:text-blue-600"
                      title="Sửa"
                      aria-label={`Sửa điểm đón ${p.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(p)}
                      className="rounded p-1 text-slate-400 transition-colors hover:text-rose-600"
                      title="Xoá"
                      aria-label={`Xoá điểm đón ${p.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {route && (
        <PickupPointFormDialog
          open={formOpen}
          pickup={editTarget}
          route={route}
          places={places}
          existingCount={pickupPoints.length}
          onOpenChange={(o) => {
            setFormOpen(o)
            if (!o) setEditTarget(null)
          }}
          onSaved={() => {
            setFormOpen(false)
            setEditTarget(null)
          }}
        />
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!deleting && !o) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận xoá</AlertDialogTitle>
            <AlertDialogDescription>
              Xoá điểm đón/trả <span className="font-semibold text-foreground">{deleteTarget?.name}</span>?
              Hành động này không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Huỷ</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
              disabled={deleting}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Đang xoá...
                </>
              ) : (
                <>
                  <Trash2 className="mr-1.5 h-4 w-4" /> Xoá
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
