import type { UseFormReturn } from 'react-hook-form'
import { z } from 'zod'
import { requiredText } from '@/lib/forms'
import { tSync } from '@/lib/i18n'

// Error messages use Zod's functional `{ error: () => ... }` form so the
// string is resolved (in the store's current language) at validation
// time, not at module load.

const HHMM = /^\d{2}:\d{2}$/

/** Sentinel value for "no seat layout" — Base UI treats '' as
 * "no selection", so the explicit empty option needs a real value. */
export const NO_LAYOUT = '__none__'

/** Optional `HH:MM` — `null` when unset (what TimePicker emits). */
const optionalTime = z
  .string()
  .regex(HHMM, { error: () => tSync('scheduleSchema.timeInvalid') })
  .nullish()

/** A price in VND; 0 (or empty) = "not set". */
const price = z.coerce
  .number({ error: () => tSync('scheduleSchema.priceNumber') })
  .min(0, { error: () => tSync('scheduleSchema.priceMin') })
  .max(1_000_000_000, { error: () => tSync('scheduleSchema.priceMax') })

/** One seat class: 0 adult = the standard price, 0 child = the brand's discount. */
const classFare = z.object({ priceAdult: price, priceChild: price })

/** One midway stop: the address plus its optional arrival time. */
const middlePoint = z.object({
  id: z.string(),
  time: optionalTime,
})

export const scheduleSchema = z
  .object({
    departureTime: requiredText('scheduleSchema.labelDepartureTime').regex(HHMM, {
      error: () => tSync('scheduleSchema.timeInvalid'),
    }),
    effectiveFrom: requiredText('scheduleSchema.labelEffectiveFrom'),
    effectiveTo: requiredText('scheduleSchema.labelEffectiveTo'),
    days: z.array(z.boolean()).length(7),
    /** Vehicle class from the admin-managed catalog — required. */
    vehicleTypeId: requiredText('scheduleSchema.labelVehicleType'),
    /** Optional brand seat layout refinement. */
    busLayoutId: z.string(),
    /** Standard seats, and any class without its own fare. */
    basePriceAdult: price,
    basePriceChild: price,
    /** Keyed by seat class (`vip`, `bed_upper`, …). */
    classFares: z.record(z.string(), classFare),
    // Sent as one comma-separated string.
    amenities: z.array(z.string()).max(20, { error: () => tSync('scheduleSchema.amenitiesMax') }),
    // ── Address point sequence (display = name, value = address id) ──
    startPointId: requiredText('scheduleSchema.labelStartPoint'),
    startPointTime: optionalTime,
    endPointId: requiredText('scheduleSchema.labelEndPoint'),
    endPointTime: optionalTime,
    middlePoints: z.array(middlePoint),
  })
  .refine((d) => !d.effectiveFrom || !d.effectiveTo || d.effectiveFrom <= d.effectiveTo, {
    error: () => tSync('scheduleSchema.dateOrder'),
    path: ['effectiveTo'],
  })
  .superRefine((d, ctx) => {
    // A child never pays more than an adult in the same seat.
    const check = (child: number, adult: number, path: string[]) => {
      if (child > 0 && child > adult) {
        ctx.addIssue({ code: 'custom', message: tSync('scheduleSchema.childAboveAdult'), path })
      }
    }
    check(d.basePriceChild, d.basePriceAdult, ['basePriceChild'])
    for (const [cls, fare] of Object.entries(d.classFares)) {
      check(fare.priceChild, fare.priceAdult || d.basePriceAdult, ['classFares', cls, 'priceChild'])
    }
  })
export type ScheduleFormValues = z.infer<typeof scheduleSchema>

/** What `useForm` receives for `scheduleSchema` (input side). */
export type ScheduleFormInput = z.input<typeof scheduleSchema>

/** The react-hook-form instance driving ScheduleFormDialog. */
export type ScheduleFormInstance = UseFormReturn<ScheduleFormInput, unknown, ScheduleFormValues>
