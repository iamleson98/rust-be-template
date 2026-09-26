/**
 * Zod schema + form types for ScheduleFormDialog
 * (create/edit a Schedule under a given Route).
 *
 * Extracted from the original 'src/features/admin/schedules/schedule-form.tsx'.
 */

import type { UseFormReturn } from 'react-hook-form'
import { z } from 'zod'
import { requiredText } from '@/lib/forms'
import { translate } from '@/lib/i18n'
import { useApp } from '@/lib/store'

// Error messages use Zod's functional `{ error: () => ... }` form so the
// string is resolved (in the store's current language) at validation
// time, not at module load.
const tSync = (key: string) => translate(useApp.getState().lang, key)

const HHMM = /^\d{2}:\d{2}$/

/** Sentinel value for "no seat layout" — Base UI treats '' as
 * "no selection", so the explicit empty option needs a real value. */
export const NO_LAYOUT = '__none__'

/** Optional `HH:MM` — `null` when unset (what TimePicker emits). */
const optionalTime = z
  .string()
  .regex(HHMM, { error: () => tSync('scheduleSchema.timeInvalid') })
  .nullish()

/** One midway stop: the address plus its optional arrival time. */
const middlePoint = z.object({
  id: z.string(),
  time: optionalTime,
})

export const scheduleSchema = z
  .object({
    departureTime: requiredText('scheduleSchema.labelDepartureTime').regex(
      HHMM,
      { error: () => tSync('scheduleSchema.timeInvalid') },
    ),
    effectiveFrom: requiredText('scheduleSchema.labelEffectiveFrom'),
    effectiveTo: requiredText('scheduleSchema.labelEffectiveTo'),
    days: z.array(z.boolean()).length(7),
    /** Vehicle class from the admin-managed catalog — required. */
    vehicleTypeId: requiredText('scheduleSchema.labelVehicleType'),
    /** Optional brand seat layout refinement. */
    busLayoutId: z.string(),
    basePriceAdult: z.coerce
      .number({ error: () => tSync('scheduleSchema.priceNumber') })
      .min(0, { error: () => tSync('scheduleSchema.priceMin') })
      .max(1_000_000_000, { error: () => tSync('scheduleSchema.priceMax') }),
    basePriceChild: z.coerce
      .number({ error: () => tSync('scheduleSchema.priceNumber') })
      .min(0, { error: () => tSync('scheduleSchema.priceMin') })
      .max(1_000_000_000, { error: () => tSync('scheduleSchema.priceMax') }),
    // Amenities are stored as a comma-separated string in the backend
    // (`amenities: Option<String>` max 5000 chars). The form edits them
    // as an array of strings for UX (checkboxes), but we MUST join them
    // into a single string before sending. The previous version sent
    // the array directly → serde would 422 because it expects a string.
    amenities: z.array(z.string()).max(20, { error: () => tSync('scheduleSchema.amenitiesMax') }),
    // ── Address point sequence (display = name, value = address id) ──
    startPointId: requiredText('scheduleSchema.labelStartPoint'),
    startPointTime: optionalTime,
    endPointId: requiredText('scheduleSchema.labelEndPoint'),
    endPointTime: optionalTime,
    middlePoints: z.array(middlePoint),
  })
  .refine(
    (d) => !d.effectiveFrom || !d.effectiveTo || d.effectiveFrom <= d.effectiveTo,
    {
      error: () => tSync('scheduleSchema.dateOrder'),
      path: ['effectiveTo'],
    },
  )
export type ScheduleFormValues = z.infer<typeof scheduleSchema>

/** What `useForm` receives for `scheduleSchema` (input side). */
export type ScheduleFormInput = z.input<typeof scheduleSchema>

/** The react-hook-form instance driving ScheduleFormDialog. */
export type ScheduleFormInstance = UseFormReturn<
  ScheduleFormInput,
  unknown,
  ScheduleFormValues
>
