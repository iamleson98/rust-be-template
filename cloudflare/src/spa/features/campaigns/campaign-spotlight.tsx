import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Check, Clock, Loader2, TicketPercent } from 'lucide-react'
import { toast } from 'sonner'
import {
  campaignsClaimMutation,
  type CampaignTierOut,
  type MyCouponsResponse,
  type PublicCampaignOut,
} from '@spa/api'
import { invalidateResources } from '@spa/api/query-client'
import { Button } from '@spa/components/ui/button'
import { RAIL } from '@spa/features/home/section'
import { useMoney } from '@spa/lib/format'
import { useT } from '@spa/lib/i18n'
import { cn } from '@spa/lib/utils'
import { useSession } from '@spa/stores/session'
import { couponErrorText, useCampaigns, useIsCustomer, useMyCoupons } from './api'
import { Countdown } from './countdown'
import { operatorsText, validityText } from './labels'
import { MyCouponCard } from './my-coupon-card'

/**
 * Why a tier cannot be claimed right now (or `null`: it can). `yours` is the
 * tier of the coupon held; `taken` the other tiers of a campaign claimed from.
 */
type Block = 'guest' | 'staff' | 'upcoming' | 'yours' | 'taken' | 'holding' | 'soldOut' | null

/**
 * The discount campaigns, right under the hero: the coupon this customer
 * holds, then each running (or about-to-open) campaign with its tiers as
 * vouchers — how much off, how many left, one tap to claim. Hidden when no
 * campaign is on, so the page never shows an empty promo band.
 */
export function CampaignSpotlight() {
  const t = useT()
  const campaigns = useCampaigns()
  const mine = useMyCoupons().data
  const signedIn = !!useSession((s) => s.user)
  const customer = useIsCustomer()
  const items = campaigns.data?.items ?? []
  if (!campaigns.data || items.length === 0) return null

  // The server's clock minus ours when the list arrived: countdowns follow the server.
  const skewMs = Date.parse(campaigns.data.serverTime) - campaigns.dataUpdatedAt
  const serverNow = Date.parse(campaigns.data.serverTime)
  const refetch = () => void campaigns.refetch()

  return (
    <section
      id="campaigns"
      aria-labelledby="campaigns-title"
      className="page-x scroll-mt-20 pt-8 md:pt-11"
    >
      {/* A calm white panel: the warm tint and icon mark it as offers without
          a wall of colour behind the text. */}
      <div className="overflow-hidden rounded-3xl bg-white shadow-soft ring-1 ring-slate-200/80">
        <div className="flex items-start gap-3 border-b border-rose-100/80 bg-linear-to-r from-rose-50 via-orange-50/60 to-white px-4 py-5 sm:px-8 sm:py-6 lg:px-10">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-rose-500 text-white shadow-sm">
            <TicketPercent className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2
              id="campaigns-title"
              className="text-xl leading-tight font-bold tracking-tight text-balance text-slate-900 sm:text-2xl"
            >
              {t('campaigns.sectionTitle')}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{t('campaigns.sectionSubtitle')}</p>
          </div>
        </div>

        <div className="px-4 py-6 sm:px-8 lg:px-10">
          {signedIn && !customer && (
            <p className="mb-5 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
              {t('campaigns.staffOnlyNote')}
            </p>
          )}
          {mine?.active && <MyCouponCard coupon={mine.active} className="mb-6" />}

          <div className="space-y-8">
            {items.map((c) => (
              <CampaignBlock
                key={c.id}
                campaign={c}
                mine={mine}
                upcoming={Date.parse(c.startsAt) > serverNow}
                signedIn={signedIn}
                customer={customer}
                skewMs={skewMs}
                onPhaseChange={refetch}
              />
            ))}
          </div>

          <p className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500">
            {t('campaigns.rules')}
          </p>
        </div>
      </div>
    </section>
  )
}

function CampaignBlock({
  campaign: c,
  mine,
  upcoming,
  signedIn,
  customer,
  skewMs,
  onPhaseChange,
}: {
  campaign: PublicCampaignOut
  mine: MyCouponsResponse | undefined
  upcoming: boolean
  signedIn: boolean
  customer: boolean
  skewMs: number
  onPhaseChange: () => void
}) {
  const t = useT()
  const claimedHere = !!mine?.claimedCampaignIds.includes(c.id)
  const held = mine?.active?.campaignId === c.id ? mine.active : undefined
  const block = (tier: CampaignTierOut): Block => {
    if (upcoming) return 'upcoming'
    // Amounts are unique within a campaign, so the amount names the tier.
    if (held?.amount === tier.amount) return 'yours'
    if (tier.remaining <= 0) return 'soldOut'
    if (!signedIn) return 'guest'
    if (!customer) return 'staff'
    if (claimedHere) return 'taken'
    if (mine?.active) return 'holding'
    return null
  }

  return (
    <article aria-labelledby={`campaign-${c.id}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id={`campaign-${c.id}`} className="text-lg font-semibold tracking-tight text-slate-900">
          {c.name}
        </h3>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200/70">
          <Clock className="size-3.5" aria-hidden />
          <Countdown
            to={upcoming ? c.startsAt : c.endsAt}
            skewMs={skewMs}
            label={upcoming ? 'campaigns.startsIn' : 'campaigns.endsIn'}
            onDone={onPhaseChange}
          />
        </span>
      </div>
      {c.description && <p className="mt-1.5 max-w-3xl text-sm text-slate-600">{c.description}</p>}
      <p className="mt-1 text-xs text-slate-500">
        {operatorsText(c, t)} ·{' '}
        {validityText(c.couponValidity === 'permanent' ? null : c.endsAt, t)}
      </p>

      <div className={cn(RAIL, 'mt-3.5 lg:grid-cols-4 2xl:grid-cols-5')}>
        {c.tiers.map((tier) => (
          <Voucher key={tier.id} campaignId={c.id} tier={tier} block={block(tier)} />
        ))}
      </div>
    </article>
  )
}

/** One tier as a voucher: the amount, a bar of what is left, and the claim button. */
function Voucher({
  campaignId,
  tier,
  block,
}: {
  campaignId: string
  tier: CampaignTierOut
  block: Block
}) {
  const t = useT()
  const money = useMoney()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const claim = useMutation(campaignsClaimMutation())
  const left = Math.max(0, tier.remaining)
  const pct = tier.totalSlots > 0 ? Math.round((left / tier.totalSlots) * 100) : 0

  const onClaim = () => {
    if (block === 'guest') {
      navigate({ to: '/login', search: { redirect: '/#campaigns' } })
      return
    }
    claim.mutate(
      { path: { id: campaignId, tier_id: tier.id } },
      {
        onSuccess: (coupon) =>
          toast.success(t('campaigns.claimedToast', { amount: money(coupon.amount) }), {
            description: t('campaigns.claimedToastDesc'),
          }),
        onError: (e) => {
          toast.error(couponErrorText(e, t) ?? t('campaigns.err.tryAgain'))
          // Lost a race (sold out, claimed in another tab): show what is true now.
          void invalidateResources(queryClient, 'campaigns', 'coupons')
        },
      },
    )
  }

  const label = {
    guest: t('campaigns.signInToClaim'),
    staff: t('campaigns.claim'),
    upcoming: t('campaigns.opensSoon'),
    yours: t('campaigns.yours'),
    taken: t('campaigns.onePerCampaign'),
    holding: t('campaigns.holdingShort'),
    soldOut: t('campaigns.soldOut'),
  }
  const gone = left === 0

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-soft ring-1 ring-slate-200/80 transition-shadow hover:shadow-float',
        gone && 'opacity-70',
      )}
    >
      <div className="bg-rose-50/60 px-4 pt-3.5 pb-3">
        <div className="text-[11px] font-semibold tracking-wide text-rose-600/80 uppercase">
          {t('campaigns.discount')}
        </div>
        <div
          className={cn(
            'text-2xl font-extrabold tracking-tight tabular-nums',
            gone ? 'text-slate-400 line-through decoration-2' : 'text-rose-600',
          )}
        >
          {money(tier.amount)}
        </div>
      </div>
      <div className="relative border-t border-dashed border-rose-200/80 px-4 pt-3 pb-4">
        <div className="flex items-center gap-2.5">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-rose-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={tier.totalSlots}
            aria-valuenow={left}
            aria-label={t('campaigns.left', { left, total: tier.totalSlots })}
          >
            <div className="h-full rounded-full bg-rose-500" style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 text-xs font-medium text-slate-500 tabular-nums">
            {t('campaigns.left', { left, total: tier.totalSlots })}
          </span>
        </div>
        <Button
          onClick={onClaim}
          disabled={(block !== null && block !== 'guest') || claim.isPending}
          className={cn(
            'mt-3 w-full rounded-xl font-semibold disabled:opacity-100',
            block === 'yours'
              ? 'bg-emerald-600 text-white'
              : block === 'guest'
                ? // One soft outline per tier for guests, not a row of red slabs.
                  'bg-white text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50'
                : 'bg-rose-600 hover:bg-rose-700 disabled:bg-slate-100 disabled:text-slate-500',
          )}
        >
          {claim.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : block === 'yours' ? (
            <Check aria-hidden />
          ) : null}
          {block ? label[block] : t('campaigns.claim')}
        </Button>
      </div>
    </div>
  )
}
