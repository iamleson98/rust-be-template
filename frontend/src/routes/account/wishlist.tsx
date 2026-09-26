'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Heart } from 'lucide-react'
import { useT } from '@/lib/i18n'

export function AccountWishlistPage() {
  const t = useT()
  return (
    <div className="page-transition">
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Heart className="h-4 w-4 text-rose-600" /> {t('account.wishlist')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {t('accountPage.wishlistDesc')}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
