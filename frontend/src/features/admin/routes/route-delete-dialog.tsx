'use client'

/**
 * Delete-confirmation AlertDialog for a route — warns that the route's
 * schedules and pickup points are deleted with it.
 *
 * Extracted from the original 'src/routes/admin/routes.tsx'.
 */

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
import { Loader2, Trash2 } from 'lucide-react'
import type { AdminRouteOut } from '@/lib/api/types.gen'

export function RouteDeleteDialog({
  deleteTarget,
  deleting,
  setDeleteTarget,
  confirmDelete,
}: {
  deleteTarget: AdminRouteOut | null
  deleting: boolean
  setDeleteTarget: React.Dispatch<React.SetStateAction<AdminRouteOut | null>>
  confirmDelete: () => void
}) {
  return (
    <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!deleting && !open) setDeleteTarget(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Xác nhận xoá</AlertDialogTitle>
          <AlertDialogDescription>
            Bạn có chắc muốn xoá tuyến{' '}
            <span className="font-semibold text-foreground">{deleteTarget?.name}</span>?
            Tất cả lịch trình và điểm đón/trả thuộc tuyến này cũng sẽ bị xoá theo.
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
            className="bg-rose-600 hover:bg-rose-700 text-white"
          >
            {deleting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Đang xoá...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-1.5" /> Xoá
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
