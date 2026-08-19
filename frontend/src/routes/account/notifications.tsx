'use client'

import { AccountShell } from '@/components/layout/account-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Bell } from 'lucide-react'

export function AccountNotificationsPage() {
  return (
    <AccountShell>
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4" /> Cài đặt thông báo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Quản lý loại thông báo bạn muốn nhận: xác nhận vé,
              nhắc lịch trình, khuyến mãi, cảnh báo giá.
            </p>
          </CardContent>
        </Card>
      </div>
    </AccountShell>
  )
}
