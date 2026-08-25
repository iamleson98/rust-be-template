
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

/* ──────────────────────────────────────────────────────────────
 *  Shared zod schemas — reused across booking / auth / admin forms
 * ────────────────────────────────────────────────────────────── */

/** Vietnamese mobile phone: starts with 0, 9–10 digits total. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^0\d{8,10}$/, 'Số điện thoại không hợp lệ (vd: 0912345678)')

/** Email — zod email() with a friendly Vietnamese message. */
export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Vui lòng nhập email')
  .email('Email không hợp lệ')

/** Booking code — 6+ alphanumeric chars, case-insensitive. */
export const bookingCodeSchema = z
  .string()
  .trim()
  .min(4, 'Mã vé quá ngắn')
  .max(24, 'Mã vé quá dài')
  .regex(/^[A-Z0-9-]+$/i, 'Mã vé chỉ chứa chữ cái và số')

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
  .min(2, 'Họ tên cần ít nhất 2 ký tự')
  .max(255, 'Họ tên quá dài')

/** Non-empty trimmed string with a custom label in the error message. */
export const requiredText = (label = 'Trường này') =>
  z.string().trim().min(1, `${label} là bắt buộc`)

/** Positive integer ≥ min. */
export const positiveInt = (min = 1) =>
  z.coerce.number().int().min(min, `Phải lớn hơn hoặc bằng ${min}`)

/** Optional string that defaults to empty when omitted. */
export const optionalText = (max = 500) =>
  z.string().trim().max(max, `Tối đa ${max} ký tự`).optional().or(z.literal(''))

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

