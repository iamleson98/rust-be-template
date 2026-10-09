import { CheckCircle2, X } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import type { TripResult } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { tSync, useT } from '@/lib/i18n'
import { VEHICLE_TYPE_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'
import { bestTripId, COMPARE_ROWS } from './compare-rows'

/** Criteria down the side, one column per trip; the best value of each row is ticked. */
export function CompareTable({ trips, onPick }: { trips: TripResult[]; onPick: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  const toggleCompare = useUi((s) => s.toggleCompare)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="sticky left-0 z-10 w-32 bg-muted/50 px-4 py-3 text-left sm:w-40 sm:px-6">
              <span className="text-xs font-semibold uppercase text-muted-foreground">
                {t('searchPage.criteria')}
              </span>
            </th>
            {trips.map((tr) => (
              <th key={tr.tripId} className="min-w-45 px-3 py-3 align-top sm:px-4">
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-base font-bold leading-tight">{tr.brandName}</div>
                    <button
                      onClick={() => toggleCompare(tr.tripId)}
                      className="text-muted-foreground hover:text-rose-600"
                      aria-label={t('searchPage.removeFromCompare')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {tr.fromName} → {tr.toName}
                  </div>
                  <Badge
                    variant="outline"
                    className="text-[10px] font-normal"
                    style={{ borderColor: tr.brandAccent, color: tr.brandAccent }}
                  >
                    {tSync(VEHICLE_TYPE_LABELS[tr.vehicleType] ?? tr.vehicleType)}
                  </Badge>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARE_ROWS.map((row) => {
            const best = bestTripId(row, trips)
            return (
              <tr key={row.labelKey} className="border-b transition-colors last:border-b-0 hover:bg-muted/40">
                <td className="sticky left-0 z-10 bg-background px-4 py-3 text-xs text-muted-foreground sm:px-6">
                  <div className="flex items-center gap-1.5">
                    {row.icon}
                    {t(row.labelKey)}
                  </div>
                </td>
                {trips.map((tr) => (
                  <td
                    key={tr.tripId}
                    className={cn(
                      'px-3 py-3 text-center sm:px-4',
                      best === tr.tripId && 'bg-blue-50/60 dark:bg-blue-950/30',
                    )}
                  >
                    <div className="relative inline-flex flex-col items-center">
                      {row.render(tr)}
                      {best === tr.tripId && (
                        <span
                          className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-white"
                          title={t('searchPage.best')}
                        >
                          <CheckCircle2 className="h-3 w-3" />
                        </span>
                      )}
                    </div>
                  </td>
                ))}
              </tr>
            )
          })}
          <tr>
            <td className="sticky left-0 z-10 bg-white px-4 py-3 sm:px-6" />
            {trips.map((tr) => (
              <td key={tr.tripId} className="px-3 py-3 text-center sm:px-4">
                <Button
                  size="sm"
                  className="gap-1.5 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700"
                  onClick={() => {
                    navigate({ to: '/trips/$tripId', params: { tripId: tr.tripId } })
                    onPick()
                  }}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t('searchPage.selectTrip')}
                </Button>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
