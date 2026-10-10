import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Check, Clock, Loader2, TicketPercent } from 'lucide-react'
import { toast } from 'sonner'
import {
  campaignsClaimMutation,
  type CampaignTierOut,
  type MyCouponsResponse,
  type PublicCampaignOut,
} from '@/api'
import { invalidateResources } from '@/api/query-client'
import { Button } from '@/components/ui/button'
import { RAIL } from '@/features/home/section'
import { useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useSession } from '@/stores/session'
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
      <div className="relative isolate overflow-hidden rounded-3xl bg-linear-to-br from-rose-600 via-rose-500 to-orange-400 px-4 py-6 text-white sm:rounded-[2rem] sm:px-8 sm:py-8 lg:px-10">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-20 -z-10 size-80 rounded-full bg-white/15 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 -z-10 size-80 rounded-full bg-amber-300/30 blur-3xl"
        />

        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/25">
            <TicketPercent className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2
              id="campaigns-title"
              className="text-2xl leading-tight font-extrabold tracking-tight text-balance sm:text-3xl"
            >
              {t('campaigns.sectionTitle')}
            </h2>
            <p className="mt-1 text-sm text-white/85 sm:text-[15px]">
              {t('campaigns.sectionSubtitle')}
            </p>
          </div>
        </div>

        {signedIn && !customer && (
          <p className="mt-4 rounded-xl bg-white/15 px-3 py-2 text-sm ring-1 ring-white/25">
            {t('campaigns.staffOnlyNote')}
          </p>
        )}
        {mine?.active && <MyCouponCard coupon={mine.active} className="mt-5" />}

        <div className="mt-6 space-y-7">
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

        <p className="mt-6 text-xs text-white/80">{t('campaigns.rules')}</p>
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
        <h3 id={`campaign-${c.id}`} className="text-lg font-bold tracking-tight sm:text-xl">
          {c.name}
        </h3>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-950/20 px-2.5 py-1 text-xs font-semibold ring-1 ring-white/20">
          <Clock className="size-3.5" aria-hidden />
          <Countdown
            to={upcoming ? c.startsAt : c.endsAt}
            skewMs={skewMs}
            label={upcoming ? 'campaigns.startsIn' : 'campaigns.endsIn'}
            onDone={onPhaseChange}
          />
        </span>
      </div>
      {c.description && <p className="mt-1.5 max-w-3xl text-sm text-white/90">{c.description}</p>}
      <p className="mt-1 text-xs text-white/80">
        {operatorsText(c, t)} ·{' '}
        {validityText(c.couponValidity === 'permanent' ? null : c.endsAt, t)}
      </p>

      <div className={cn(RAIL, 'mt-3.5 lg:grid-cols-4')}>
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
        'flex flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-lg shadow-rose-950/15',
        gone && 'opacity-80',
      )}
    >
      <div className="bg-linear-to-br from-rose-50 to-orange-50 px-4 pt-3.5 pb-3">
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
      <div className="relative border-t-2 border-dashed border-rose-100 px-4 pt-3 pb-4">
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
