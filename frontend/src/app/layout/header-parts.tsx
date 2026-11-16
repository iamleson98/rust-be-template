import { Globe } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import type { Lang } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** The site's light, translucent bar (the admin console has its own frame). */
export const tone = {
  bar: 'border-b border-slate-200/80 bg-white/85 text-slate-900 backdrop-blur-xl',
  icon: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
}

/** What the language button looks like; the menu behind it loads apart (`header-menus.tsx`). */
export const LANGUAGE_BUTTON = cn('h-9 gap-1.5 rounded-full px-2.5', tone.icon)

export function LanguageButtonContent({ lang }: { lang: Lang }) {
  return (
    <>
      <Globe className="size-4" />
      <span className="hidden text-xs font-semibold sm:inline">{lang === 'vi' ? 'VI' : 'EN'}</span>
    </>
  )
}

export const ACCOUNT_BUTTON =
  'ml-1 inline-flex h-9 items-center gap-2 rounded-full bg-white p-1 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 sm:pr-3'

export function AccountButtonContent({ name, initials }: { name: string; initials: string }) {
  return (
    <>
      <Avatar className="size-7">
        <AvatarFallback className="bg-primary text-[11px] font-bold text-primary-foreground">
          {initials || 'U'}
        </AvatarFallback>
      </Avatar>
      <span className="hidden max-w-30 truncate text-xs font-semibold sm:inline">{name}</span>
    </>
  )
}
