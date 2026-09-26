'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Bell } from 'lucide-react'
import { useT } from '@/lib/i18n'

export function AccountNotificationsPage() {
  const t = useT()
  return (
    <div className="page-transition">
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4" /> {t('accountPage.notificationSettings')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {t('accountPage.notificationSettingsDesc')}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
