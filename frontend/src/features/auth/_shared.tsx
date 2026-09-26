/**
 * Shared types, schemas and small presentational helpers used by the
 * login and registration forms.
 *
 * Extracted from the original `login-page.tsx` so each form can live
 * in its own file without duplicating the zod schemas or the
 * password-strength meter / tab-button component.
 */

import type React from 'react'
import { z } from 'zod'
import { cn } from '@/lib/utils'
import { emailSchema, fullNameSchema } from '@/lib/forms'
import { translate, useT } from '@/lib/i18n'
import { useApp } from '@/lib/store'

export type Tab = 'customer' | 'register'

// ── Customer login schema ─────────────────────────────────
// Backend route: `POST /api/auth/login` with body `{ email, password }`.
// Factory takes `t` so validation messages follow the active language
// (same pattern as `makeBrandSchema` in the admin brand form).
export const makeCustomerSchema = (t: ReturnType<typeof useT>) =>
  z.object({
    email: emailSchema,
    password: z.string().min(1, t('authPage.passwordRequired')),
  })
export type CustomerFormValues = z.infer<ReturnType<typeof makeCustomerSchema>>

// ── Register form schema ──────────────────────────────────
export const makeRegisterSchema = (t: ReturnType<typeof useT>) =>
  z
    .object({
      fullName: fullNameSchema,
      email: z
        .string()
        .trim()
        .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), t('validation.email')),
      phone: z
        .string()
        .trim()
        .refine((v) => !v || /^0\d{8,10}$/.test(v), t('authPage.phoneInvalid')),
      password: z
        .string()
        .min(8, t('validation.passwordMin'))
        .max(128, t('validation.passwordMax')),
      confirm: z.string().min(1, t('authPage.confirmPasswordRequired')),
    })
    .refine((d) => d.email || d.phone, {
      message: t('auth.emailOrPhoneHint'),
      path: ['email'],
    })
    .refine((d) => d.password === d.confirm, {
      message: t('validation.passwordMatch'),
      path: ['confirm'],
    })
export type RegisterFormValues = z.infer<ReturnType<typeof makeRegisterSchema>>

// ── Helpers ───────────────────────────────────────────────
/** Heuristic password-strength scorer used by the registration meter. */
const STRENGTH_LABEL_KEYS = [
  'auth.passwordWeak',
  'auth.passwordFair',
  'auth.passwordGood',
  'auth.passwordStrong',
  'auth.passwordVeryStrong',
] as const

export function scorePassword(pwd: string): { score: number; label: string } {
  if (!pwd) return { score: 0, label: '' }
  let score = 0
  if (pwd.length >= 6) score++
  if (pwd.length >= 10) score++
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++
  if (/\d/.test(pwd) && /[^A-Za-z0-9]/.test(pwd)) score++
  const labelKey = STRENGTH_LABEL_KEYS[score]
  return { score, label: labelKey ? translate(useApp.getState().lang, labelKey) : '' }
}

// ── Tab button ───────────────────────────────────────────
export function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 py-3.5 text-xs sm:text-sm font-semibold transition-colors relative',
        active ? 'text-blue-700' : 'text-slate-500 hover:text-slate-700',
      )}
    >
      {icon}
      {label}
      {active && (
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-10 rounded-full bg-blue-600" />
      )}
    </button>
  )
}
