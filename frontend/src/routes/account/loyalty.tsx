'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Gift } from 'lucide-react'
import { useApp } from '@/lib/store'

export function AccountLoyaltyPage() {
  const { loyaltyPoints } = useApp()
  return (
    <div className="page-transition">
      <div className="container mx-auto px-4 py-6 max-w-4xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Gift className="h-4 w-4 text-amber-600" /> Điểm thưởng
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold text-amber-600">
              {loyaltyPoints?.toLocaleString('vi-VN') ?? '0'}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Tích điểm mỗi khi đặt vé — 1 điểm cho mỗi 1.000đ.
              Đổi điểm lấy vé miễn phí hoặc ưu đãi đặc biệt.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
