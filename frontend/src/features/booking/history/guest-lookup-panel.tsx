'use client'

// Extracted from the original 'my-bookings.tsx'.

import { useNavigate } from '@/router'
import { Search, ChevronDown } from 'lucide-react'
import { Card as UiCard } from '@/components/ui/card'
import type { Currency } from '@/lib/currency'
import { BookingItem } from '@/features/booking/history/booking-types'
import { BookingList } from '@/features/booking/history/booking-list'
import { GuestLookupForm } from '@/features/booking/history/guest-lookup-form'
import { MyBookingsSkeleton } from '@/features/booking/history/my-bookings-skeleton'
import { NoResultsFound } from '@/features/search/no-results-found'

export function GuestLookupPanel({
  showGuestLookup,
  setShowGuestLookup,
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
  showGuestLookup: boolean
  setShowGuestLookup: React.Dispatch<React.SetStateAction<boolean>>
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
  const navigate = useNavigate()

  return (
    <div className="mt-8">
      <div className="rounded-xl ring-1 ring-black/5 bg-white overflow-hidden">
        <button
          type="button"
          onClick={() => setShowGuestLookup((s) => !s)}
          className="w-full flex items-center justify-between gap-2 px-4 md:px-5 py-3.5 text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-slate-50 transition-colors"
          aria-expanded={showGuestLookup}
        >
          <span className="inline-flex items-center gap-2">
            <Search className="h-4 w-4 text-blue-600" />
            Tra cứu vé khác bằng mã vé hoặc SĐT
          </span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${showGuestLookup ? 'rotate-180' : ''}`}
          />
        </button>
        {showGuestLookup && (
          <div className="border-t bg-slate-50/50 px-4 md:px-5 py-4 space-y-4">
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
            {loading ? (
              <MyBookingsSkeleton count={2} />
            ) : searched && results.length === 0 ? (
              <UiCard className="ring-1 ring-black/5 overflow-hidden">
                <NoResultsFound
                  onReset={onReset}
                  onExplore={() => navigate({ to: '/' })}
                />
              </UiCard>
            ) : searched ? (
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
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
