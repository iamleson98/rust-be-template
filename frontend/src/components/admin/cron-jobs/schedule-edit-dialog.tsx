'use client'

/**
 * Dialog for editing a cron schedule: interval (days) + fire time
 * (hour:minute) + a "re-arm next run" option. Validation mirrors the
 * backend's `UpdateCronJobRequest` ranges (1-365 days, 0-23 h, 0-59 m).
 */

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import type { CronJobOut, UpdateCronJobRequest } from '@/lib/api/types.gen'

export function ScheduleEditDialog({
  job,
  open,
  onOpenChange,
  onSave,
  saving,
}: {
  job: CronJobOut | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (body: UpdateCronJobRequest) => void
  saving: boolean
}) {
  const [intervalDays, setIntervalDays] = useState('14')
  const [atHour, setAtHour] = useState('2')
  const [atMinute, setAtMinute] = useState('0')
  const [resetNextRun, setResetNextRun] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Re-seed the form each time a different job is opened.
  useEffect(() => {
    if (job && open) {
      setIntervalDays(String(job.intervalDays))
      setAtHour(String(job.atHour))
      setAtMinute(String(job.atMinute))
      setResetNextRun(true)
      setError(null)
    }
  }, [job, open])

  const submit = () => {
    const days = Number.parseInt(intervalDays, 10)
    const hour = Number.parseInt(atHour, 10)
    const minute = Number.parseInt(atMinute, 10)
    if (Number.isNaN(days) || days < 1 || days > 365) {
      setError('Chu kỳ phải từ 1 đến 365 ngày')
      return
    }
    if (Number.isNaN(hour) || hour < 0 || hour > 23) {
      setError('Giờ phải từ 0 đến 23')
      return
    }
    if (Number.isNaN(minute) || minute < 0 || minute > 59) {
      setError('Phút phải từ 0 đến 59')
      return
    }
    setError(null)
    onSave({
      intervalDays: days,
      atHour: hour,
      atMinute: minute,
      resetNextRun,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Chỉnh lịch chạy</DialogTitle>
          <DialogDescription>
            {job ? `Chu kỳ + giờ chạy của «${job.jobType}»` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cron-interval">Chu kỳ (ngày)</Label>
              <Input
                id="cron-interval"
                type="number"
                min={1}
                max={365}
                value={intervalDays}
                onChange={(e) => setIntervalDays(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cron-hour">Giờ</Label>
              <Input
                id="cron-hour"
                type="number"
                min={0}
                max={23}
                value={atHour}
                onChange={(e) => setAtHour(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cron-minute">Phút</Label>
              <Input
                id="cron-minute"
                type="number"
                min={0}
                max={59}
                value={atMinute}
                onChange={(e) => setAtMinute(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[hsl(var(--primary))]"
              checked={resetNextRun}
              onChange={(e) => setResetNextRun(e.target.checked)}
            />
            <span>
              Đặt lại lần chạy kế tiếp
              <span className="block text-xs text-muted-foreground">
                Lần chạy tiếp theo sẽ tính từ bây giờ theo giờ mới (bỏ qua lịch cũ).
              </span>
            </span>
          </label>

          {error ? (
            <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Huỷ
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            Lưu lịch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
