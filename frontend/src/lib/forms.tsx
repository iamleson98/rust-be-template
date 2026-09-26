
/**
 * Shared form-validation helpers.
 *
 * Conventions (modern best-practice stack):
 *  - react-hook-form for state + validation lifecycle
 *  - zod for schema definition
 *  - @hookform/resolvers/zod to wire them together
 *  - shadcn/ui <Form> / <FormField> / <FormItem> / <FormLabel> /
 *    <FormControl> / <FormMessage> for accessible field markup
 *
 * Required-field labels render a red asterisk via <FieldLabel required>.
 * Field errors render in red below the control via <FormMessage />
 * (already styled with `text-destructive` in components/ui/form.tsx).
 */

import { z } from 'zod'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { translate } from '@/lib/i18n'
import { useApp } from '@/lib/store'

/* Error messages use Zod's functional `{ error: () => … }` form so they
 * resolve the CURRENT app language at validation time (same pattern as
 * the feature-level schemas, e.g. booking-form.tsx). */
const tSync = (key: string, params?: Record<string, string | number>) =>
  translate(useApp.getState().lang, key, params)

/* ──────────────────────────────────────────────────────────────
 *  Shared zod schemas — reused across booking / auth / admin forms
 * ────────────────────────────────────────────────────────────── */

/** Vietnamese mobile phone: starts with 0, 9–10 digits total. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^0\d{8,10}$/, { error: () => tSync('validation.phone') })

/** Email — zod email() with a friendly Vietnamese message. */
export const emailSchema = z
  .string()
  .trim()
  .min(1, { error: () => tSync('validation.emailRequired') })
  .email({ error: () => tSync('validation.email') })

/** Booking code — 6+ alphanumeric chars, case-insensitive. */
export const bookingCodeSchema = z
  .string()
  .trim()
  .min(4, { error: () => tSync('validation.bookingCodeMin') })
  .max(24, { error: () => tSync('validation.bookingCodeMax') })
  .regex(/^[A-Z0-9-]+$/i, { error: () => tSync('validation.bookingCode') })

/**
 * Passenger / customer full name — at least 2 chars, max 255 (matches
 * backend's `full_name` column + `RegisterRequest` + `HoldReq.contact_name`).
 *
 * The previous version rejected digits (`^[^\d]+$`) — too strict for
 * Vietnamese names that may contain ID numbers or suffixes. Backend
 * allows any UTF-8 string. We only enforce min/max length.
 */
export const fullNameSchema = z
  .string()
  .trim()
  .min(2, { error: () => tSync('validation.nameMin') })
  .max(255, { error: () => tSync('validation.nameMax') })

/** Non-empty trimmed string with a custom label in the error message. */
export const requiredText = (labelKey?: string) =>
  z.string().trim().min(1, {
    error: () =>
      labelKey === undefined
        ? tSync('validation.required')
        : tSync('validation.requiredLabel', { label: tSync(labelKey) }),
  })

/** Positive integer ≥ min. */
export const positiveInt = (min = 1) =>
  z.coerce.number().int().min(min, { error: () => tSync('validation.minNumber', { min }) })

/** Optional string that defaults to empty when omitted. */
export const optionalText = (max = 500) =>
  z.string().trim().max(max, { error: () => tSync('validation.maxChars', { max }) }).optional().or(z.literal(''))

/* ──────────────────────────────────────────────────────────────
 *  FieldLabel — shared required-field marker
 * ──────────────────────────────────────────────────────────────
 *
 * Renders a form label with an optional red asterisk for required
 * fields. Use this instead of raw <FormLabel>Label *</FormLabel>
 * so the marker style is consistent across all forms.
 *
 * Usage:
 *   <FieldLabel required>Họ và tên</FieldLabel>
 *   <FieldLabel>Email (tuỳ chọn)</FieldLabel>
 */

export function FieldLabel({
  children,
  required,
  className,
  htmlFor,
}: {
  children: React.ReactNode
  required?: boolean
  className?: string
  htmlFor?: string
}) {
  return (
    <Label
      htmlFor={htmlFor}
      className={cn(
        'text-xs font-semibold uppercase tracking-wide text-muted-foreground',
        className,
      )}
    >
      {children}
      {required && (
        <span className="text-destructive ml-0.5" aria-hidden="true">
          *
        </span>
      )}
    </Label>
  )
}

