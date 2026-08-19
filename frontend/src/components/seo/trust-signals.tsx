'use client'

/**
 * TrustSignals — reusable trust + privacy component.
 *
 * Shows SSL badge, data protection copy, and consumer rights affirmation.
 * Place near payment forms, booking dialogs, and on the homepage hero.
 *
 * The copy complies with Vietnam's Decree 13/2023/ND-CP on Personal
 * Data Protection — it affirms that user data is only used for the
 * stated purpose (sending tickets + trip notifications) and is NOT
 * shared with third parties.
 */

import { ShieldCheck, Lock, FileCheck, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'

const TRUST_ITEMS = [
  {
    icon: Lock,
    label: 'SSL 256-bit',
    description: 'Mã hoá toàn diện',
  },
  {
    icon: ShieldCheck,
    label: 'Bảo vệ dữ liệu',
    description: 'Không chia sẻ bên thứ 3',
  },
  {
    icon: FileCheck,
    label: 'NĐ-CP 13/2023',
    description: 'Tuân thủ nghị định',
  },
]

/** Compact trust bar — shows 3 trust badges in a row. */
export function TrustBar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-4 sm:gap-6 py-3',
        'flex-wrap',
        className,
      )}
      role="region"
      aria-label="Cam kết bảo mật"
    >
      {TRUST_ITEMS.map((item) => {
        const Icon = item.icon
        return (
          <div
            key={item.label}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Icon className="h-3.5 w-3.5 text-success" />
            <span className="font-medium">{item.label}</span>
            <span className="hidden sm:inline text-muted-foreground/70">
              · {item.description}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Privacy notice — affirms data protection + consumer rights.
 * Place near the contact-info form in the booking dialog.
 */
export function PrivacyNotice({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg bg-info/5 border border-info/20 p-3',
        'text-xs text-muted-foreground',
        className,
      )}
      role="note"
      aria-label="Chính sách bảo mật dữ liệu"
    >
      <ShieldCheck className="h-4 w-4 text-info shrink-0 mt-0.5" />
      <div className="space-y-1">
        <p className="font-medium text-info-foreground">
          Thông tin của bạn được bảo vệ
        </p>
        <p>
          Chúng tôi chỉ dùng SĐT và email để gửi vé điện tử + thông báo chuyến đi.
          <strong className="text-foreground"> Không chia sẻ với bên thứ ba</strong> —
          tuân thủ Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân.
        </p>
        <p className="text-muted-foreground/80">
          Bạn có quyền yêu cầu truy cập, chỉnh sửa hoặc xoá dữ liệu cá nhân bất cứ lúc nào.
        </p>
      </div>
    </div>
  )
}

/**
 * Payment trust badges — small row of trust indicators near the
 * "Pay now" button in the payment dialog.
 */
export function PaymentTrustBadges({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-3 text-[10px] text-muted-foreground',
        className,
      )}
    >
      <span className="flex items-center gap-1">
        <Lock className="h-3 w-3" /> Mã hoá SSL
      </span>
      <span className="text-border">•</span>
      <span className="flex items-center gap-1">
        <ShieldCheck className="h-3 w-3" /> PCI DSS
      </span>
      <span className="text-border">•</span>
      <span className="flex items-center gap-1">
        <Eye className="h-3 w-3" /> Hoàn tiền 24h
      </span>
    </div>
  )
}

/**
 * Instructional info banner — shows a tip or instruction with an icon.
 * Used for guidance on the seat map, search results, etc.
 */
export function InfoBanner({
  icon: Icon,
  title,
  children,
  variant = 'info',
  className,
}: {
  icon: React.ComponentType<{ className?: string }>
  title?: string
  children: React.ReactNode
  variant?: 'info' | 'success' | 'warning'
  className?: string
}) {
  const variants = {
    info: 'bg-info/5 border-info/20 text-info-foreground',
    success: 'bg-success/5 border-success/20 text-success-foreground',
    warning: 'bg-warning/5 border-warning/20 text-warning-foreground',
  }
  const iconColors = {
    info: 'text-info',
    success: 'text-success',
    warning: 'text-warning',
  }
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border p-3 text-xs',
        variants[variant],
        className,
      )}
      role="note"
    >
      <Icon className={cn('h-4 w-4 shrink-0 mt-0.5', iconColors[variant])} />
      <div className="flex-1">
        {title && <p className="font-medium mb-0.5">{title}</p>}
        <div className="text-muted-foreground">{children}</div>
      </div>
    </div>
  )
}
