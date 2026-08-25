/**
 * Shared types, schemas and small presentational helpers used by the
 * customer login, registration and employee login forms.
 *
 * Extracted from the original `login-page.tsx` so each form can live
 * in its own file without duplicating the zod schemas or the
 * password-strength meter / tab-button component.
 */

import type React from 'react'
import { z } from 'zod'
import { cn } from '@/lib/utils'
import { emailSchema, fullNameSchema } from '@/lib/forms'

export type Tab = 'customer' | 'register' | 'employee'

/** The customer login flow used to be OTP-based but now uses email+password. */
export type CustomerStep = 'credentials' | 'success'

// ── Customer login schema ─────────────────────────────────
// Backend route: `POST /api/auth/login` with body `{ email, password }`.
export const customerZodSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
})
export type CustomerFormValues = z.infer<typeof customerZodSchema>

// ── Register form schema ──────────────────────────────────
export const registerZodSchema = z
  .object({
    fullName: fullNameSchema,
    email: z
      .string()
      .trim()
      .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Email không hợp lệ'),
    phone: z
      .string()
      .trim()
      .refine((v) => !v || /^0\d{8,10}$/.test(v), 'Số điện thoại không hợp lệ'),
    password: z
      .string()
      .min(8, 'Mật khẩu phải có ít nhất 8 ký tự')
      .max(128, 'Mật khẩu tối đa 128 ký tự'),
    confirm: z.string().min(1, 'Vui lòng xác nhận mật khẩu'),
  })
  .refine((d) => d.email || d.phone, {
    message: 'Vui lòng nhập email hoặc số điện thoại',
    path: ['email'],
  })
  .refine((d) => d.password === d.confirm, {
    message: 'Mật khẩu xác nhận không khớp',
    path: ['confirm'],
  })
export type RegisterFormValues = z.infer<typeof registerZodSchema>

// ── Employee login schema ─────────────────────────────────
export const employeeZodSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, 'Mật khẩu phải có ít nhất 8 ký tự').max(128, 'Mật khẩu tối đa 128 ký tự'),
})
export type EmployeeFormValues = z.infer<typeof employeeZodSchema>

// ── Helpers ───────────────────────────────────────────────
/** Heuristic password-strength scorer used by the registration meter. */
export function scorePassword(pwd: string): { score: number; label: string } {
  if (!pwd) return { score: 0, label: '' }
  let score = 0
  if (pwd.length >= 6) score++
  if (pwd.length >= 10) score++
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++
  if (/\d/.test(pwd) && /[^A-Za-z0-9]/.test(pwd)) score++
  const labels = ['Rất yếu', 'Yếu', 'Trung bình', 'Tốt', 'Mạnh']
  return { score, label: labels[score] || '' }
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
