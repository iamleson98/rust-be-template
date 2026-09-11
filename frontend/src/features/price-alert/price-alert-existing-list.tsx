'use client'

/**
 * PriceAlertExistingList — the "Cảnh báo đã tạo" list inside the
 * price-alert dialog: one row per alert (status badge, route, target
 * price) with a delete action.
 *
 * Extracted from the original `price-alert-dialog.tsx`. The delete
 * handler (mutation + toasts) stays in the dialog and is passed down
 * with its original name.
 */

import type { PriceAlertOut as ExistingAlert } from '@/lib/api/types.gen'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Trash2 } from 'lucide-react'
import { formatVND } from '@/lib/types'

export function PriceAlertExistingList({
  existingAlerts,
  handleDeleteAlert,
}: {
  existingAlerts: ExistingAlert[]
  handleDeleteAlert: (id: string) => void
}) {
  return (
                <div className="space-y-1.5 pt-2 border-t">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Cảnh báo đã tạo ({existingAlerts.length})
                  </Label>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {existingAlerts.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center gap-2 rounded-lg border bg-white px-3 py-1.5"
                      >
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${a.status === 'active'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}
                        >
                          {a.status === 'active' ? 'Đang theo dõi' : 'Đã kích hoạt'}
                        </Badge>
                        <div className="text-xs flex-1 min-w-0 truncate">
                          <span className="font-medium">{a.fromName} → {a.toName}</span>
                          <span className="text-muted-foreground"> ≤ {formatVND(a.targetPrice ?? 0)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteAlert(a.id)}
                          className="text-rose-500 hover:text-rose-700 p-1 rounded"
                          aria-label="Xoá"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
  )
}
