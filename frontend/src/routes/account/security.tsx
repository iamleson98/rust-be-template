'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ShieldCheck, Lock, Smartphone } from 'lucide-react'
import { useT } from '@/lib/i18n'

export function AccountSecurityPage() {
  const t = useT()
  return (
    <div className="page-transition">
      <div className="container mx-auto px-4 py-6 max-w-4xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" /> {t('accountPage.securityTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">{t('auth.password')}</div>
                  <div className="text-xs text-muted-foreground">{t('accountPage.changePasswordDesc')}</div>
                </div>
              </div>
              <button className="text-xs text-primary font-medium hover:underline">
                {t('accountPage.changePassword')}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Smartphone className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">{t('accountPage.twoFactor')}</div>
                  <div className="text-xs text-muted-foreground">{t('accountPage.twoFactorDesc')}</div>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">{t('accountPage.notEnabled')}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('accountPage.dataRights')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t('accountPage.dataRightsDesc')}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
