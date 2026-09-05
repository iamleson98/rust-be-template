'use client'

/**
 * LoginPage — the public `/login` page shell.
 *
 * Owns the page-level layout (background, header, tab switcher, trust
 * note) and delegates each form to its own file under `auth/`:
 *   - CustomerLogin   → `./customer-login`
 *   - RegisterForm    → `./register-form`
 *   - EmployeeLogin   → `./employee-login`
 *
 * The shared zod schemas, the password-strength meter helper and the
 * `TabButton` presentational component live in `./_shared`.
 */

import { useEffect, useState } from 'react'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import {
  ShieldCheck,
  Bus,
  User,
  Briefcase,
  ArrowLeft,
  UserPlus,
} from 'lucide-react'
import { TabButton, type Tab } from './_shared'
import { CustomerLogin } from './customer-login'
import { RegisterForm } from './register-form'
import { EmployeeLogin } from './employee-login'
import { isStaffUser } from '@/lib/store'

export function LoginPage() {
  const { user } = useApp()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('customer')

  // If already logged in, redirect to the right place.
  // The user object comes from /api/auth/me (server-verified) — see store.tsx.
  useEffect(() => {
    if (user) {
      if (isStaffUser(user)) navigate({ to: '/admin' })
      else navigate({ to: '/bookings' })
    }
  }, [user, navigate])

  return (
    <div className="relative min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-10 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 -z-10 bg-slate-900">
        <div className="absolute inset-0 bg-linear-to-br from-slate-900 via-slate-800 to-slate-900" />
        <div className="absolute inset-0 bg-linear-to-t from-slate-900/80 via-transparent to-slate-900/40" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
            backgroundSize: '28px 28px',
          }}
        />
        <div className="absolute top-1/4 right-[10%] h-48 w-48 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="absolute bottom-1/4 left-[10%] h-40 w-40 rounded-full bg-blue-400/10 blur-3xl" />
      </div>

      <div className="w-full max-w-md">
        <button
          onClick={() => navigate({ to: '/' })}
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 mb-5"
        >
          <ArrowLeft className="h-4 w-4" />
          Về trang chủ
        </button>

        <div className="rounded-2xl bg-white overflow-hidden ring-1 ring-black/5">
          {/* Header */}
          <div className="relative bg-linear-to-br from-blue-600 via-blue-700 to-blue-800 px-6 pt-6 pb-7 text-white">
            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,white,transparent_60%)]" />
            <div className="relative flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-white/15 ring-1 ring-white/30 backdrop-blur inline-flex items-center justify-center">
                <Bus className="h-6 w-6" />
              </div>
              <div>
                <h1 className="font-bold text-xl leading-tight">VeXeVN</h1>
                <p className="text-[12px] text-blue-100 mt-0.5">
                  Đăng nhập để quản lý vé, đánh giá và ưu đãi
                </p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-200">
            <TabButton
              active={tab === 'customer'}
              onClick={() => setTab('customer')}
              icon={<User className="h-4 w-4" />}
              label="Khách hàng"
            />
            <TabButton
              active={tab === 'register'}
              onClick={() => setTab('register')}
              icon={<UserPlus className="h-4 w-4" />}
              label="Đăng ký"
            />
            <TabButton
              active={tab === 'employee'}
              onClick={() => setTab('employee')}
              icon={<Briefcase className="h-4 w-4" />}
              label="Nhân viên"
            />
          </div>

          {/* Content */}
          <div className="p-6">
            {tab === 'customer' && <CustomerLogin />}
            {tab === 'register' && <RegisterForm />}
            {tab === 'employee' && <EmployeeLogin />}
          </div>
        </div>

        {/* Trust note */}
        <div className="mt-5 flex items-center justify-center gap-2 text-xs text-blue-600">
          <ShieldCheck className="h-3.5 w-3.5" />
          Thông tin cá nhân của bạn được bảo mật và mã hoá an toàn tuyệt đối.
        </div>
      </div>
    </div>
  )
}
