'use client'

/**
 * The address-sequence section of ScheduleFormDialog — start point,
 * ordered midway stops and end point, each with an optional arrival
 * time. Extracted from the original 'src/features/admin/schedules/schedule-form.tsx'.
 */

import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { TimePicker } from '@/components/ui/time-picker'
import {
  ArrowDown,
  ArrowUp,
  CircleDot,
  Flag,
  MapPin,
  Plus,
  Route as RouteIcon,
  Trash2,
} from 'lucide-react'
import type { AdminAddressOut } from '@/lib/api/types.gen'
import { AddressPointSelect } from '@/features/admin/addresses/address-point-select'
import type { ScheduleFormInput, ScheduleFormInstance } from './schedule-schema'

export function ScheduleRouteSection({
  form,
  brandId,
  knownAddresses,
  startName,
  endName,
  middlePoints,
  openCreateFor,
  setMiddle,
  setMiddleTime,
  moveMiddle,
  addMiddle,
  removeMiddle,
}: {
  form: ScheduleFormInstance
  brandId?: string
  knownAddresses: AdminAddressOut[]
  startName: string | undefined
  endName: string | undefined
  middlePoints: ScheduleFormInput['middlePoints']
  openCreateFor: (slot: 'start' | 'end' | number) => void
  setMiddle: (index: number, value: string | undefined) => void
  setMiddleTime: (index: number, time: string | null) => void
  moveMiddle: (index: number, delta: -1 | 1) => void
  addMiddle: () => void
  removeMiddle: (index: number) => void
}) {
  return (
    <>
              {/* ── Điểm đón / trả (address sequence + arrival times) ── */}
              <div className="rounded-lg border bg-slate-50/60 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <RouteIcon className="h-4 w-4 text-blue-600" />
                    Lộ trình đón — trả khách
                  </div>
                  {startName && endName ? (
                    <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                      <CircleDot className="h-3 w-3 text-blue-600 shrink-0" />
                      <span className="truncate">{startName}</span>
                      <span className="shrink-0">→</span>
                      <span className="text-muted-foreground/70 shrink-0">
                        +{middlePoints.filter((m) => !!m.id).length}
                      </span>
                      <span className="shrink-0">→</span>
                      <Flag className="h-3 w-3 text-rose-600 shrink-0" />
                      <span className="truncate">{endName}</span>
                    </span>
                  ) : null}
                </div>

                {/* Start point + arrival time */}
                <div className="grid grid-cols-[1fr_auto] gap-2 items-start">
                  <FormField
                    control={form.control}
                    name="startPointId"
                    render={({ field }) => (
                      <FormItem className="grid gap-1.5">
                        <FormLabel>
                          <span className="flex items-center gap-1.5">
                            <CircleDot className="h-3.5 w-3.5 text-blue-600" />
                            Điểm khởi hành <span className="text-destructive">*</span>
                          </span>
                        </FormLabel>
                        <FormControl>
                          <AddressPointSelect
                            kind="pickup"
                            value={field.value}
                            onChange={field.onChange}
                            brandId={brandId}
                            extraAddresses={knownAddresses}
                            onCreateNew={() => openCreateFor('start')}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="startPointTime"
                    render={({ field }) => (
                      <FormItem className="grid gap-1.5 w-30">
                        <FormLabel className="text-muted-foreground">Giờ đến</FormLabel>
                        <FormControl>
                          <TimePicker value={field.value} onChange={field.onChange} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Middle points (ordered) + arrival times */}
                <FormField
                  control={form.control}
                  name="middlePoints"
                  render={({ field }) => (
                    <FormItem className="grid gap-2">
                      <FormLabel className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-amber-600" />
                        Điểm trung gian (đón / trả giữa đường)
                      </FormLabel>
                      <div className="space-y-2">
                        {field.value.map((mid, i: number) => (
                          <div key={i} className="grid grid-cols-[auto_1fr_auto_auto] gap-1.5 items-center">
                            <span className="h-6 w-6 shrink-0 rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold flex items-center justify-center border border-amber-200">
                              {i + 1}
                            </span>
                            <AddressPointSelect
                              kind="middle"
                              value={mid.id || undefined}
                              onChange={(v) => setMiddle(i, v)}
                              brandId={brandId}
                              extraAddresses={knownAddresses}
                              onCreateNew={() => openCreateFor(i)}
                            />
                            <div className="w-28">
                              <TimePicker
                                value={mid.time ?? null}
                                onChange={(t) => setMiddleTime(i, t)}
                                placeholder="--:--"
                              />
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <button
                                type="button"
                                aria-label="Di chuyển lên"
                                disabled={i === 0}
                                onClick={() => moveMiddle(i, -1)}
                                className="h-4 w-6 rounded text-muted-foreground hover:text-foreground hover:bg-slate-100 disabled:opacity-30 flex items-center justify-center"
                              >
                                <ArrowUp className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                aria-label="Di chuyển xuống"
                                disabled={i === field.value.length - 1}
                                onClick={() => moveMiddle(i, 1)}
                                className="h-4 w-6 rounded text-muted-foreground hover:text-foreground hover:bg-slate-100 disabled:opacity-30 flex items-center justify-center"
                              >
                                <ArrowDown className="h-3 w-3" />
                              </button>
                            </div>
                            <button
                              type="button"
                              aria-label="Xoá điểm trung gian"
                              onClick={() => removeMiddle(i)}
                              className="col-start-4 justify-self-center h-9 w-9 shrink-0 rounded-md text-muted-foreground hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={addMiddle}
                          className="w-full h-9 rounded-md border border-dashed text-sm text-muted-foreground hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50/50 flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Plus className="h-4 w-4" />
                          Thêm điểm trung gian
                        </button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* End point + arrival time */}
                <div className="grid grid-cols-[1fr_auto] gap-2 items-start">
                  <FormField
                    control={form.control}
                    name="endPointId"
                    render={({ field }) => (
                      <FormItem className="grid gap-1.5">
                        <FormLabel>
                          <span className="flex items-center gap-1.5">
                            <Flag className="h-3.5 w-3.5 text-rose-600" />
                            Điểm kết thúc <span className="text-destructive">*</span>
                          </span>
                        </FormLabel>
                        <FormControl>
                          <AddressPointSelect
                            kind="drop"
                            value={field.value}
                            onChange={field.onChange}
                            brandId={brandId}
                            extraAddresses={knownAddresses}
                            onCreateNew={() => openCreateFor('end')}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="endPointTime"
                    render={({ field }) => (
                      <FormItem className="grid gap-1.5 w-30">
                        <FormLabel className="text-muted-foreground">Giờ đến</FormLabel>
                        <FormControl>
                          <TimePicker value={field.value} onChange={field.onChange} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Cột “Giờ đến” là thời gian xe dự kiến tới mỗi điểm (không bắt buộc).
                </p>
              </div>
    </>
  )
}
