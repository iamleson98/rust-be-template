/**
 * The header's two menus (language, account). They are built on Base UI's menu
 * and positioning code, a large part of what the first page would download,
 * and nothing in the first paint needs them: `header.tsx` loads this file once
 * the page is idle, or at once when a visitor reaches for one.
 */
import { Briefcase, Check, LayoutDashboard, LogOut, Mail, Phone, Ticket } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { SessionUser } from '@/api'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useLogout } from '@/features/auth/api'
import { useT } from '@/lib/i18n'
import { personInitials } from '@/lib/text'
import { cn } from '@/lib/utils'
import { usePrefs } from '@/stores/prefs'
import { isStaffUser } from '@/stores/session'
import {
  ACCOUNT_BUTTON,
  AccountButtonContent,
  LANGUAGE_BUTTON,
  LanguageButtonContent,
} from './header-parts'

export function LanguageMenu({ defaultOpen }: { defaultOpen?: boolean }) {
  const t = useT()
  const lang = usePrefs((s) => s.lang)
  const setLang = usePrefs((s) => s.setLang)

  const choose = (next: 'vi' | 'en') => {
    setLang(next)
    toast.success(next === 'vi' ? t('lang.switchedVi') : t('lang.switchedEn'))
  }

  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className={LANGUAGE_BUTTON} />}
      >
        <LanguageButtonContent lang={lang} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => choose('vi')} className="flex items-center gap-2">
          <Check className={cn('size-3.5 text-primary', lang !== 'vi' && 'invisible')} />
          Tiếng Việt
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => choose('en')} className="flex items-center gap-2">
          <Check className={cn('size-3.5 text-primary', lang !== 'en' && 'invisible')} />
          English
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AccountMenu({ user, defaultOpen }: { user: SessionUser; defaultOpen?: boolean }) {
  const t = useT()
  const navigate = useNavigate()
  const logout = useLogout()
  const initials = personInitials(user.name)

  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            title={user.name}
            aria-label={user.name}
            className={ACCOUNT_BUTTON}
          />
        }
      >
        <AccountButtonContent name={user.name} initials={initials} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2.5">
            <Avatar className="size-9">
              <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
                {initials || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{user.name}</div>
              <div className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
                {user.email ? (
                  <>
                    <Mail className="size-3 shrink-0" />
                    <span className="truncate">{user.email}</span>
                  </>
                ) : (
                  <>
                    <Phone className="size-3 shrink-0" />
                    <span className="truncate">{user.phone}</span>
                  </>
                )}
              </div>
              {isStaffUser(user) && (
                <div className="mt-1 inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                  <Briefcase className="size-2.5" />
                  {user.employeeRole === 'admin'
                    ? t('nav.role.admin')
                    : user.employeeRole === 'support_lead'
                      ? t('nav.role.supportLead')
                      : user.employeeRole === 'ops'
                        ? t('nav.role.operations')
                        : t('nav.role.support')}
                  {user.brandName ? ` · ${user.brandName}` : ''}
                </div>
              )}
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate({ to: '/account' })} className="gap-2">
          <LayoutDashboard className="size-4" /> {t('nav.myConsole')}
        </DropdownMenuItem>
        {!isStaffUser(user) && (
          <DropdownMenuItem onClick={() => navigate({ to: '/account/trips' })} className="gap-2">
            <Ticket className="size-4" /> {t('layout.account.tripHistory')}
          </DropdownMenuItem>
        )}
        {isStaffUser(user) && (
          <DropdownMenuItem onClick={() => navigate({ to: '/admin' })} className="gap-2">
            <Briefcase className="size-4" /> {t('nav.admin')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={logout}
          className="gap-2 text-rose-600 focus:bg-rose-50 focus:text-rose-700"
        >
          <LogOut className="size-4" /> {t('nav.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
