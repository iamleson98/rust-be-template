import type { ComponentProps } from 'react'
import type { DayButton } from 'react-day-picker'
import { CalendarDayButton } from '@/components/ui/calendar'
import { useT } from '@/lib/i18n'
import { holidayOn, toLunar, yearName, type LunarDate } from '@/lib/lunar'

/** "15", or "1/8" on the first day of a lunar month (as on Vietnamese wall calendars). */
function lunarLabel(lunar: LunarDate, leapMark: string): string {
  return lunar.day === 1
    ? `${lunar.day}/${lunar.month}${lunar.leap ? leapMark : ''}`
    : String(lunar.day)
}

/** A calendar day with its lunar date under it; public and traditional holidays in red. */
export function LunarDayButton(props: ComponentProps<typeof DayButton>) {
  const t = useT()
  const lunar = toLunar(props.day.date)
  const holiday = holidayOn(props.day.date, lunar)
  const lunarText = lunarLabel(lunar, t('lunar.leapMark'))
  const holidayName = holiday && t(`lunar.holiday.${holiday}`)
  return (
    <CalendarDayButton
      {...props}
      data-holiday={!!holiday}
      title={holidayName || undefined}
      aria-label={[props['aria-label'], `${t('lunar.label')} ${lunarText}`, holidayName]
        .filter(Boolean)
        .join(', ')}
      className="gap-0.5 data-[holiday=true]:not-data-[selected-single=true]:text-rose-600 [&>span]:text-[10px] [&>span]:leading-none dark:data-[holiday=true]:not-data-[selected-single=true]:text-rose-400"
    >
      {props.children}
      <span>{lunarText}</span>
    </CalendarDayButton>
  )
}

/** Under the calendar: the chosen day in the lunar calendar, and its holiday if any. */
export function LunarFooter({ date }: { date: Date | null }) {
  const t = useT()
  if (!date) {
    return (
      <p className="px-1 pt-2 text-xs text-muted-foreground">
        <span className="font-medium text-rose-600 dark:text-rose-400">●</span> {t('lunar.legend')}
      </p>
    )
  }
  const lunar = toLunar(date)
  const holiday = holidayOn(date, lunar)
  return (
    <p className="px-1 pt-2 text-xs text-muted-foreground">
      {t('lunar.dateLine', {
        day: lunar.day,
        month: `${lunar.month}${lunar.leap ? ` ${t('lunar.leapWord')}` : ''}`,
        year: yearName(lunar.year),
      })}
      {holiday && (
        <span className="font-medium text-rose-600 dark:text-rose-400">
          {' · '}
          {t(`lunar.holiday.${holiday}`)}
        </span>
      )}
    </p>
  )
}
