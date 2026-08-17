'use client'

/**
 * EmployeeLogin — email + password login form for staff.
 *
 * Extracted from the original `login-page.tsx`. Uses the shared
 * `employeeZodSchema` from `./_shared`.
 *
 * Backend route: `POST /api/auth/employee-login` with body
 * `{ email, password }`. On success the user is redirected to /admin
 * (the router's `beforeLoad` guard also checks `user.type === 'employee'`).
 */

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import { useEmployeeLogin } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { toast } from 'sonner'
import {
  Loader2,
  ChevronRight,
  Mail,
  Lock,
  Briefcase,
  Eye,
  EyeOff,
} from 'lucide-react'
import {
  employeeZodSchema,
  type EmployeeFormValues,
} from './_shared'

export function EmployeeLogin() {
  const { setUser } = useApp()
  const navigate = useNavigate()
  const [showPwd, setShowPwd] = useState(false)

  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeZodSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { email: '', password: '' },
  })
  const { control, handleSubmit } = form

  const loginMut = useEmployeeLogin({
    onSuccess: (data: any) => {
      const user = data?.user ?? data?.data?.user
      if (!user) return
      setUser(user)
      toast.success(`Chào mừng ${user.name}!`)
      navigate({ to: '/admin' })
    },
    onError: () => {
      toast.error('Đăng nhập thất bại. Vui lòng kiểm tra email/mật khẩu.')
    },
  })

  const onSubmit = (values: EmployeeFormValues) => {
    loginMut.mutate({ body: { email: values.email, password: values.password } } as any)
  }

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={control}
          name="email"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Email công ty <span className="text-destructive">*</span>
              </FormLabel>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <FormControl>
                  <Input
                    {...field}
                    placeholder="VD: admin@bus.vn"
                    type="email"
                    autoFocus
                    className="pl-10 h-11"
                  />
                </FormControl>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="password"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Mật khẩu <span className="text-destructive">*</span>
              </FormLabel>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <FormControl>
                  <Input
                    {...field}
                    placeholder="••••••••"
                    type={showPwd ? 'text' : 'password'}
                    className="pl-10 pr-10 h-11"
                  />
                </FormControl>
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          disabled={loginMut.isPending}
          className="w-full gap-2 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white h-11"
        >
          {loginMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Briefcase className="h-4 w-4" />}
          Đăng nhập nhân viên
          <ChevronRight className="h-4 w-4" />
        </Button>

        <div className="rounded-lg bg-blue-50 ring-1 ring-blue-200 px-3 py-2.5">
          <div className="text-[11px] font-semibold text-blue-700 mb-1">Tài khoản nhân viên demo</div>
          <div className="text-[11px] text-blue-600 space-y-0.5">
            <div>• admin@bus.vn — mật khẩu: <code className="font-mono">admin123</code></div>
            <div>• an@phuongtrang.vn — mật khẩu: <code className="font-mono">staff123</code></div>
            <div className="text-blue-400 pt-0.5">Mật khẩu được mã hoá bcrypt, tài khoản khoá sau 5 lần sai.</div>
          </div>
        </div>
      </form>
    </Form>
  )
}
