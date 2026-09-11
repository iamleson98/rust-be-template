'use client'

/**
 * Delete-confirmation AlertDialog for a schedule.
 *
 * Extracted from the original 'src/routes/admin/schedules.tsx'.
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
import type { AdminScheduleOut } from '@/lib/api/types.gen'

export function ScheduleDeleteDialog({
  deleteTarget,
  routeName,
  deleting,
  setDeleteTarget,
  confirmDelete,
}: {
  deleteTarget: AdminScheduleOut | null
  routeName?: string
  deleting: boolean
  setDeleteTarget: React.Dispatch<React.SetStateAction<AdminScheduleOut | null>>
  confirmDelete: () => void
}) {
  return (
    <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!deleting && !open) setDeleteTarget(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Xác nhận xoá</AlertDialogTitle>
          <AlertDialogDescription>
            Bạn có chắc muốn xoá lịch trình{' '}
            <span className="font-semibold text-foreground">
              {deleteTarget?.departureTime}
            </span>{' '}
            của tuyến <span className="font-semibold text-foreground">{routeName}</span>?
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
