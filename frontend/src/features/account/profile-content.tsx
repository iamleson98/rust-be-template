'use client'

/**
 * ProfileContent — user profile + account overview shown at /account.
 *
 * Shows:
 *   - Profile card (avatar, name, phone, email, edit button)
 *   - Quick stats (total bookings, loyalty points, wishlist count)
 *   - Quick links (bookings, wishlist, loyalty, support, security)
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import {
  Ticket,
  Gift,
  Heart,
  Phone,
  Mail,
  ChevronRight,
  Shield,
  Headset,
  Bell,
} from 'lucide-react'

export function ProfileContent() {
  const { user, loyaltyPoints } = useApp()
  const navigate = useNavigate()

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : 'U'

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl space-y-6">
      {/* ── Profile header ────────────────────────────────── */}
      <Card>
        <CardContent className="p-6 flex items-center gap-4">
          <Avatar className="h-16 w-16">
            <AvatarFallback className="bg-primary/10 text-primary text-lg font-bold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold truncate">{user?.name || 'Người dùng'}</h2>
            <div className="flex flex-col gap-0.5 mt-1 text-sm text-muted-foreground">
              {user?.phone && (
                <span className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5" /> {user.phone}
                </span>
              )}
              {user?.email && (
                <span className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> {user.email}
                </span>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => navigate({ to: '/account/security' })}
          >
            <Shield className="h-3.5 w-3.5" /> Bảo mật
          </Button>
        </CardContent>
      </Card>

      {/* ── Quick stats ──────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          icon={<Ticket className="h-4 w-4" />}
          label="Vé đã đặt"
          value="—"
          color="text-blue-600 bg-blue-50 dark:bg-blue-950/30"
          onClick={() => navigate({ to: '/bookings' })}
        />
        <StatCard
          icon={<Gift className="h-4 w-4" />}
          label="Điểm thưởng"
          value={loyaltyPoints?.toString() ?? '0'}
          color="text-amber-600 bg-amber-50 dark:bg-amber-950/30"
          onClick={() => navigate({ to: '/account/loyalty' })}
        />
        <StatCard
          icon={<Heart className="h-4 w-4" />}
          label="Yêu thích"
          value="—"
          color="text-rose-600 bg-rose-50 dark:bg-rose-950/30"
          onClick={() => navigate({ to: '/account/wishlist' })}
        />
      </div>

      {/* ── Quick links ──────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Truy cập nhanh</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <QuickLink
            icon={<Ticket className="h-4 w-4 text-blue-600" />}
            label="Vé của tôi"
            desc="Xem lịch sử đặt vé và trạng thái chuyến đi"
            onClick={() => navigate({ to: '/bookings' })}
          />
          <QuickLink
            icon={<Headset className="h-4 w-4 text-violet-600" />}
            label="Hỗ trợ & Chat"
            desc="Chat với nhân viên hỗ trợ hoặc gọi điện"
            onClick={() => navigate({ to: '/' })}
          />
          <QuickLink
            icon={<Heart className="h-4 w-4 text-rose-600" />}
            label="Danh sách yêu thích"
            desc="Các tuyến đường bạn đã lưu"
            onClick={() => navigate({ to: '/account/wishlist' })}
          />
          <QuickLink
            icon={<Gift className="h-4 w-4 text-amber-600" />}
            label="Điểm thưởng"
            desc="Tích điểm và đổi ưu đãi"
            onClick={() => navigate({ to: '/account/loyalty' })}
          />
          <QuickLink
            icon={<Bell className="h-4 w-4 text-blue-600" />}
            label="Thông báo"
            desc="Cài đặt loại thông báo nhận"
            onClick={() => navigate({ to: '/account/notifications' })}
          />
          <QuickLink
            icon={<Shield className="h-4 w-4 text-emerald-600" />}
            label="Bảo mật & Mật khẩu"
            desc="Đổi mật khẩu, xác thực 2 bước, quyền dữ liệu"
            onClick={() => navigate({ to: '/account/security' })}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  color,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  value: string
  color: string
  onClick?: () => void
}) {
  return (
    <Card className="cursor-pointer" onClick={onClick}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`flex items-center justify-center h-10 w-10 rounded-lg ${color}`}>
          {icon}
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-bold tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function QuickLink({
  icon,
  label,
  desc,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  desc?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-accent transition-colors"
    >
      {icon}
      <div className="flex-1 min-w-0">
        <div className="font-medium">{label}</div>
        {desc && <div className="text-xs text-muted-foreground truncate">{desc}</div>}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </button>
  )
}
