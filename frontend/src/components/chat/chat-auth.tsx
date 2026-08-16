'use client'

/**
 * ChatAuth — the pre-chat registration + login-required views.
 *
 * Extracted from the original `chat-widget.tsx`. Two states:
 *   - 'auth': guest registration form (name + phone OR email). On submit,
 *     the parent POSTs `/api/auth/register` with a generated password;
 *     the httpOnly auth cookie is set on success.
 *   - 'login-required': shown when the JWT cookie is missing/expired.
 *     Offers a single button that opens the global auth dialog.
 *
 * The actual submit handler is passed in as `onSubmitGuestRegistration`
 * so the parent owns the WS connection lifecycle.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Loader2,
  UserPlus,
  Phone,
  Mail,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react'
import { useApp } from '@/lib/store'

export function ChatAuthView({
  authChecking,
  regName,
  regPhone,
  regEmail,
  regError,
  regSubmitting,
  onSetName,
  onSetPhone,
  onSetEmail,
  onSubmit,
}: {
  authChecking: boolean
  regName: string
  regPhone: string
  regEmail: string
  regError: string | null
  regSubmitting: boolean
  onSetName: (v: string) => void
  onSetPhone: (v: string) => void
  onSetEmail: (v: string) => void
  onSubmit: () => void
}) {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="p-5 space-y-4">
        <div className="text-center">
          <div className="inline-flex h-14 w-14 rounded-full bg-rose-50 items-center justify-center mb-3">
            <UserPlus className="h-7 w-7 text-rose-600" />
          </div>
          <h3 className="font-bold text-base">Bắt đầu trò chuyện</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Vui lòng cung cấp họ tên và số điện thoại (hoặc email) để chúng tôi có thể hỗ trợ bạn.
            Tài khoản sẽ được tự động tạo miễn phí.
          </p>
        </div>

        {authChecking ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="reg-name" className="text-xs font-medium">
                Họ và tên <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="reg-name"
                value={regName}
                onChange={(e) => onSetName(e.target.value)}
                placeholder="Nguyễn Văn A"
                maxLength={80}
                autoComplete="name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-phone" className="text-xs font-medium">Số điện thoại</Label>
              <Input
                id="reg-phone"
                value={regPhone}
                onChange={(e) => onSetPhone(e.target.value)}
                placeholder="09xx xxx xxx"
                inputMode="tel"
                autoComplete="tel"
              />
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <div className="flex-1 h-px bg-border" />
              HOẶC
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-email" className="text-xs font-medium">Email</Label>
              <Input
                id="reg-email"
                value={regEmail}
                onChange={(e) => onSetEmail(e.target.value)}
                placeholder="email@example.com"
                inputMode="email"
                autoComplete="email"
              />
            </div>

            {regError && (
              <div className="rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{regError}</span>
              </div>
            )}

            <Button
              onClick={onSubmit}
              disabled={regSubmitting}
              className="w-full gap-2 bg-linear-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800"
            >
              {regSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Đang tạo tài khoản...
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" /> Bắt đầu chat
                </>
              )}
            </Button>

            <p className="text-[10px] text-muted-foreground text-center pt-1">
              Bằng việc tiếp tục, bạn đồng ý với điều khoản sử dụng. Thông tin của bạn được bảo mật.
            </p>

            <div className="text-center pt-2">
              <button
                onClick={() => {
                  useApp.getState().setAuthOpen(true)
                  useApp.getState().setChatOpen(false)
                }}
                className="text-xs text-rose-600 hover:text-rose-700 hover:underline font-medium"
              >
                Đã có tài khoản? Đăng nhập
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-auto border-t p-3 bg-slate-50 text-xs text-muted-foreground flex items-center justify-between">
        <span className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> 1900 6067</span>
        <span className="flex items-center gap-1.5"><Mail className="h-3 w-3" /> cskh@vexevn.vn</span>
      </div>
    </div>
  )
}

export function ChatLoginRequiredView({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <div className="inline-flex h-14 w-14 rounded-full bg-amber-50 items-center justify-center mb-3">
        <AlertTriangle className="h-7 w-7 text-amber-600" />
      </div>
      <h3 className="font-bold text-base">Phiên đăng nhập hết hạn</h3>
      <p className="text-xs text-muted-foreground mt-1 mb-4">
        Vui lòng đăng nhập lại để tiếp tục trò chuyện với nhân viên hỗ trợ.
      </p>
      <Button onClick={onLogin} className="gap-2 bg-rose-600 hover:bg-rose-700">
        <ShieldCheck className="h-4 w-4" /> Đăng nhập
      </Button>
    </div>
  )
}
