import type { CampaignBrandOut } from '@/api'
import { formatDayTime } from '@/lib/format'
import type { useT } from '@/lib/i18n'

type Translate = ReturnType<typeof useT>

/** "Any operator", or the first few names and how many more. */
export function operatorsText(
  scope: { allBrands: boolean; brands: CampaignBrandOut[] },
  t: Translate,
): string {
  if (scope.allBrands) return t('campaigns.allOperators')
  const names = scope.brands.slice(0, 3).map((b) => b.name)
  const more = scope.brands.length - names.length
  return t('campaigns.forOperators', {
    names: more > 0 ? `${names.join(', ')} +${more}` : names.join(', '),
  })
}

/** Until when a coupon can be booked with: a date, or no expiry at all. */
export const validityText = (validUntil: string | null | undefined, t: Translate) =>
  validUntil
    ? t('campaigns.validUntil', { date: formatDayTime(validUntil) })
    : t('campaigns.noExpiry')
