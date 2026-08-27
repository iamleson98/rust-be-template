'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import { useApp, type TripResult } from '@/lib/store'
import { useNavigate } from '@/router'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    X,
    GitCompare,
    Star,
    Clock,
    Wallet,
    Users,
    Bus,
    CheckCircle2,
    Sparkles,
    Loader2,
} from 'lucide-react'
import { formatVND, VEHICLE_TYPE_LABELS, formatTimeVN } from '@/lib/types'

type CompareRow = {
    label: string
    icon: React.ReactNode
    render: (t: TripResult) => React.ReactNode
    highlight?: (t: TripResult, all: TripResult[]) => boolean
    sortValue?: (t: TripResult) => number // lower = better
}

// Rows are static config — declared at module scope to avoid recreating
// the array (and its inline closures) on every render.
const COMPARE_ROWS: CompareRow[] = [
    {
        label: 'Giờ đi',
        icon: <Clock className="h-3.5 w-3.5" />,
        render: (t) => (
            <div className="text-center">
                <div className="font-mono text-base font-bold">{formatTimeVN(t.departureAt ?? '')}</div>
                <div className="text-[10px] text-muted-foreground">{t.fromName}</div>
            </div>
        ),
        sortValue: (t) => new Date(t.departureAt ?? '').getTime(),
    },
    {
        label: 'Giờ đến',
        icon: <Bus className="h-3.5 w-3.5" />,
        render: (t) => (
            <div className="text-center">
                <div className="font-mono text-base font-bold">{formatTimeVN(t.arrivalAt ?? '')}</div>
                <div className="text-[10px] text-muted-foreground">{t.toName}</div>
            </div>
        ),
    },
    {
        label: 'Loại xe',
        icon: <Bus className="h-3.5 w-3.5" />,
        render: (t) => (
            <Badge variant="outline" className="font-normal">
                {VEHICLE_TYPE_LABELS[t.vehicleType] ?? t.vehicleType}
            </Badge>
        ),
    },
    {
        label: 'Số ghế trống',
        icon: <Users className="h-3.5 w-3.5" />,
        render: (t) => (
            <span className={t.availableSeats <= 3 ? 'text-rose-600 font-semibold' : 'font-medium'}>
                {t.availableSeats}/{t.totalSeats}
            </span>
        ),
        sortValue: (t) => -t.availableSeats,
    },
    {
        label: 'Đánh giá',
        icon: <Star className="h-3.5 w-3.5" />,
        render: (t) => (
            <span className="inline-flex items-center gap-1">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                <span className="font-medium">{t.brandRating.toFixed(1)}</span>
            </span>
        ),
        sortValue: (t) => -t.brandRating,
    },
    {
        label: 'Giá từ',
        icon: <Wallet className="h-3.5 w-3.5" />,
        render: (t) => (
            <span className="font-extrabold text-blue-700 text-lg">{formatVND(t.minPrice)}</span>
        ),
        sortValue: (t) => t.minPrice,
    },
    {
        label: 'Tiện nghi',
        icon: <Sparkles className="h-3.5 w-3.5" />,
        render: (t) => (
            <div className="flex flex-wrap gap-1 justify-center">
                {t.amenities.slice(0, 4).map((a) => (
                    <Badge key={a} variant="outline" className="text-[9px] font-normal px-1 py-0">
                        {a}
                    </Badge>
                ))}
            </div>
        ),
    },
]

export const TripCompare = memo(function TripCompare() {
    const { compareList, compareOpen, setCompareOpen, toggleCompare, clearCompare } = useApp()
    const navigate = useNavigate()
    const [trips, setTrips] = useState<TripResult[]>([])
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        let cancelled = false
        if (compareList.length === 0) {
            return
        }
        Promise.all(
            compareList.map(async (tripId) => {
                // Use search results first if available; otherwise fetch detail
                const cached = (window as any).__lastSearchResults as TripResult[] | undefined
                const fromCache = cached?.find((t) => t.tripId === tripId)
                return fromCache
            })
        )
            .then((rows) => {
                if (cancelled) return
                setTrips(rows.filter(Boolean) as TripResult[])
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [compareList])

    // Memoize the "best tripId" per row so we don't re-sort on every render.
    const bestIdsByRow = useMemo(() => {
        return COMPARE_ROWS.map((row) => {
            if (!row.sortValue || trips.length === 0) return null
            let best = trips[0]
            let bestVal = row.sortValue(best)
            for (let i = 1; i < trips.length; i++) {
                const v = row.sortValue(trips[i])
                if (v < bestVal) {
                    best = trips[i]
                    bestVal = v
                }
            }
            return best.tripId
        })
    }, [trips])

    const getBest = (rowIndex: number) => bestIdsByRow[rowIndex]

    return (
        <>
            {compareOpen && (
                <>
                    <div
                        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
                        onClick={() => setCompareOpen(false)}
                    />
                    <div
                        className="fixed inset-0 sm:inset-x-4 sm:top-8 sm:bottom-8 sm:m-auto z-50 sm:max-w-5xl bg-white sm:rounded-2xl ring-1 ring-black/10 flex flex-col overflow-hidden"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b bg-linear-to-r from-violet-600 to-fuchsia-600 text-white">
                            <div className="flex items-center gap-2">
                                <div className="h-8 w-8 rounded-full bg-white/15 inline-flex items-center justify-center">
                                    <GitCompare className="h-4 w-4" />
                                </div>
                                <div>
                                    <div className="font-semibold text-sm">So sánh chuyến xe</div>
                                    <div className="text-[10px] text-white/80">
                                        {trips.length}/3 chuyến • Mục tô đậm là tốt nhất
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => setCompareOpen(false)}
                                className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-white/15"
                                aria-label="Đóng"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="flex-1 overflow-auto">
                            {loading ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
                                </div>
                            ) : compareList.length === 0 ? (
                                <div className="p-12 text-center">
                                    <div className="inline-flex h-14 w-14 rounded-full bg-slate-100 items-center justify-center mb-3">
                                        <GitCompare className="h-7 w-7 text-slate-400" />
                                    </div>
                                    <h3 className="font-semibold mb-1">Chưa có chuyến để so sánh</h3>
                                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                                        Trở lại kết quả tìm kiếm và nhấn nút"So sánh"trên các thẻ chuyến để thêm vào đây. Có thể so sánh tối đa 3 chuyến cùng lúc.
                                    </p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b">
                                                <th className="sticky left-0 z-10 bg-white px-4 sm:px-6 py-3 text-left w-32 sm:w-40">
                                                    <span className="text-xs font-semibold uppercase text-muted-foreground">Tiêu chí</span>
                                                </th>
                                                {trips.map((t) => (
                                                    <th key={t.tripId} className="px-3 sm:px-4 py-3 align-top min-w-45">
                                                        <div className="space-y-1.5">
                                                            <div className="flex items-start justify-between gap-2">
                                                                <div className="font-bold text-base leading-tight">{t.brandName}</div>
                                                                <button
                                                                    onClick={() => toggleCompare(t.tripId)}
                                                                    className="text-muted-foreground hover:text-rose-600"
                                                                    aria-label="Xoá khỏi so sánh"
                                                                >
                                                                    <X className="h-3.5 w-3.5" />
                                                                </button>
                                                            </div>
                                                            <div className="text-xs text-muted-foreground">
                                                                {t.fromName} → {t.toName}
                                                            </div>
                                                            <Badge
                                                                variant="outline"
                                                                className="text-[10px] font-normal"
                                                                style={{ borderColor: t.brandAccent, color: t.brandAccent }}
                                                            >
                                                                {VEHICLE_TYPE_LABELS[t.vehicleType] ?? t.vehicleType}
                                                            </Badge>
                                                        </div>
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {COMPARE_ROWS.map((row, idx) => {
                                                const bestId = getBest(idx)
                                                return (
                                                    <tr key={idx} className="border-b last:border-b-0 hover:bg-slate-50/50">
                                                        <td className="sticky left-0 z-10 bg-white px-4 sm:px-6 py-3 text-xs text-muted-foreground">
                                                            <div className="flex items-center gap-1.5">
                                                                {row.icon}
                                                                {row.label}
                                                            </div>
                                                        </td>
                                                        {trips.map((t) => {
                                                            const isBest = bestId === t.tripId
                                                            return (
                                                                <td
                                                                    key={t.tripId}
                                                                    className={`px-3 sm:px-4 py-3 text-center ${isBest ? 'bg-blue-50/60' : ''
                                                                        }`}
                                                                >
                                                                    <div className="relative inline-flex flex-col items-center">
                                                                        {row.render(t)}
                                                                        {isBest && (
                                                                            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-blue-500 text-white inline-flex items-center justify-center" title="Tốt nhất">
                                                                                <CheckCircle2 className="h-3 w-3" />
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            )
                                                        })}
                                                    </tr>
                                                )
                                            })}
                                            <tr>
                                                <td className="sticky left-0 z-10 bg-white px-4 sm:px-6 py-3" />
                                                {trips.map((t) => (
                                                    <td key={t.tripId} className="px-3 sm:px-4 py-3 text-center">
                                                        <Button
                                                            size="sm"
                                                            className="gap-1.5 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700"
                                                            onClick={() => {
                                                                navigate({ to: '/trips/$tripId', params: { tripId: t.tripId } })
                                                                setCompareOpen(false)
                                                            }}
                                                        >
                                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                                            Chọn chuyến
                                                        </Button>
                                                    </td>
                                                ))}
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="border-t px-4 sm:px-6 py-2 flex items-center justify-between bg-slate-50">
                            <Button variant="ghost" size="sm" onClick={clearCompare} disabled={trips.length === 0}>
                                Xoá tất cả
                            </Button>
                            <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                                <Sparkles className="h-3 w-3 text-blue-500" />
                                Mục tô xanh là tốt nhất theo từng tiêu chí
                            </div>
                        </div>
                    </div>
                </>
            )}
        </>
    )
})
