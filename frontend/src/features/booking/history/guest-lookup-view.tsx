'use client'

// Extracted from the original 'my-bookings.tsx'.

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Ticket, CalendarCheck, Wallet, ShieldCheck, LogIn } from 'lucide-react'
import { Card, CardContent, Card as UiCard } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/currency'
import type { Currency } from '@/lib/currency'
import { useT } from '@/lib/i18n'
import { BookingItem } from '@/features/booking/history/booking-types'
import { BookingList } from '@/features/booking/history/booking-list'
import { GuestLookupForm } from '@/features/booking/history/guest-lookup-form'
import { MyBookingsSkeleton } from '@/features/booking/history/my-bookings-skeleton'
import { NoBookingsYet } from '@/features/booking/history/no-bookings-yet'
import { NoResultsFound } from '@/features/search/no-results-found'
import { StatsRow } from './stats-row'

export function GuestLookupView({
  searchCode,
  setSearchCode,
  searchPhone,
  setSearchPhone,
  loading,
  doSearch,
  recentSearches,
  onRecentClick,
  onRemoveRecent,
  results,
  searched,
  onReset,
  expandedId,
  setExpandedId,
  onCancelBooking,
  cancelling,
  currency,
}: {
  searchCode: string
  setSearchCode: (v: string) => void
  searchPhone: string
  setSearchPhone: (v: string) => void
  loading: boolean
  doSearch: () => void
  recentSearches: string[]
  onRecentClick: (term: string) => void
  onRemoveRecent: (term: string) => void
  results: BookingItem[]
  searched: boolean
  onReset: () => void
  expandedId: string | null
  setExpandedId: React.Dispatch<React.SetStateAction<string | null>>
  onCancelBooking: (bookingId: string) => void
  cancelling: string | null
  currency: Currency
}) {
  const t = useT()
  const navigate = useNavigate()

  const totalBookings = results.length
  const totalAmount = results
    .filter((b) => b.status === 'paid' || b.status === 'confirmed')
    .reduce((s, b) => s + b.total, 0)
  // Snapshot of 'now' taken once per mount — Date.now() directly in the
  // render body is impure (breaks memoization under React Compiler).
  const [now] = useState(Date.now)
  const upcoming = results.filter(
    (b) => b.trip && b.status !== 'cancelled' && new Date(b.trip.departureAt).getTime() > now,
  ).length

  return (
    <>
      <Card className="ring-1 ring-black/5 overflow-hidden backdrop-blur">
        <CardContent className="p-5 md:p-7">
          <GuestLookupForm
            searchCode={searchCode}
            setSearchCode={setSearchCode}
            searchPhone={searchPhone}
            setSearchPhone={setSearchPhone}
            loading={loading}
            doSearch={doSearch}
            recentSearches={recentSearches}
            onRecentClick={onRecentClick}
            onRemoveRecent={onRemoveRecent}
          />
          <div className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
            {t('bookingHistory.privacyNote')}
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 pb-10">
        {loading ? (
          <MyBookingsSkeleton count={3} />
        ) : searched && results.length === 0 ? (
          <UiCard className="ring-1 ring-black/5 overflow-hidden">
            <NoResultsFound
              onReset={onReset}
              onExplore={() => navigate({ to: '/' })}
            />
          </UiCard>
        ) : searched ? (
          <div className="space-y-5">
            <StatsRow
              stats={[
                { icon: <Ticket className="h-5 w-5" />, label: t('bookingHistory.statTotalTickets'), value: String(totalBookings), accent: 'from-blue-500 to-blue-500', subtitle: t('bookingHistory.statTicketsBooked') },
                { icon: <CalendarCheck className="h-5 w-5" />, label: t('bookingHistory.statUpcoming'), value: String(upcoming), accent: 'from-blue-500 to-blue-500', subtitle: t('bookingHistory.statUpcomingSub') },
                { icon: <Wallet className="h-5 w-5" />, label: t('bookingHistory.statTotalSpend'), value: formatCurrency(totalAmount, currency), accent: 'from-amber-500 to-orange-500', subtitle: t('bookingHistory.statPaidSub') },
              ]}
            />
            <BookingList
              variant="search"
              bookings={results}
              currency={currency}
              loading={loading}
              loaded
              expandedId={expandedId}
              onToggleExpand={(id) => setExpandedId(expandedId === id ? null : id)}
              onCancelClick={onCancelBooking}
              cancellingId={cancelling}
              onExploreOther={() => navigate({ to: '/' })}
            />
          </div>
        ) : (
          <UiCard className="ring-1 ring-black/5 overflow-hidden">
            <NoBookingsYet onSearch={() => navigate({ to: '/' })} />
            <div className="border-t bg-blue-50/60 px-6 py-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
                <div className="h-10 w-10 rounded-xl bg-blue-100 text-blue-600 inline-flex items-center justify-center shrink-0">
                  <LogIn className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-foreground">
                    {t('bookingHistory.loginPromptTitle')}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t('bookingHistory.loginPromptSubtitle')}
                  </div>
                </div>
                <Button
                  size="sm"
                  className="gap-1.5 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white shrink-0"
                  onClick={() => navigate({ to: '/login' })}
                >
                  <LogIn className="h-4 w-4" />
                  {t('auth.login')}
                </Button>
              </div>
            </div>
          </UiCard>
        )}
      </div>
    </>
  )
}
