'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Heart } from 'lucide-react'

export function AccountWishlistPage() {
  return (
    <div className="page-transition">
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Heart className="h-4 w-4 text-rose-600" /> Danh sách yêu thích
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Các tuyến đường và chuyến xe bạn đã lưu sẽ hiển thị ở đây.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
