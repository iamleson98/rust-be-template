import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, Clock, MessageSquareHeart, Star } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useT } from '@/lib/i18n'
import { FeedbackHero } from './feedback-hero'
import { FeedbackPager } from './feedback-pager'
import { PendingRideCard, PendingRideSkeleton } from './pending-ride-card'
import { SentFeedbackCard, SentFeedbackSkeleton } from './sent-feedback-card'
import { PAGE_SIZE, useFeedbackData } from './use-feedback-data'

function EmptyCard({ icon, tone, title, desc }: { icon: React.ReactNode; tone: string; title: string; desc: string }) {
  return (
    <Card className="ring-1 ring-black/5">
      <CardContent className="space-y-2 px-6 py-12 text-center">
        <div className={`mx-auto grid size-12 place-items-center rounded-2xl ${tone}`}>{icon}</div>
        <div className="font-semibold">{title}</div>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{desc}</p>
      </CardContent>
    </Card>
  )
}

/** `/account/feedback`: rate finished trips, and manage the reviews already sent. */
export function AccountFeedbackContent() {
  const t = useT()
  const [tab, setTab] = useState<'pending' | 'sent'>('pending')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const data = useFeedbackData(page)

  const average = data.reviews.length
    ? data.reviews.reduce((sum, r) => sum + r.rating, 0) / data.reviews.length
    : 0
  const approved = data.reviews.filter((r) => r.status === 'approved').length
  const toggle = (id: string | null, current: string | null) => (id === current ? null : id)

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 md:px-6">
      <FeedbackHero average={average} sent={data.total} approved={approved} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'pending' | 'sent')}>
        <TabsList className="h-10 rounded-lg bg-muted p-1">
          <TabsTrigger value="pending" className="gap-1.5 rounded-md px-4">
            <Clock className="size-3.5" />
            {t('accountPage.feedback.tabPending')}
            {data.pending.length > 0 && (
              <span className="ml-1 grid h-4 min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                {data.pending.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="sent" className="gap-1.5 rounded-md px-4">
            <Star className="size-3.5" />
            {t('accountPage.feedback.tabSent')} ({data.total})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4 space-y-3 outline-none">
          {data.ridesLoading ? (
            Array.from({ length: 3 }, (_, i) => <PendingRideSkeleton key={i} />)
          ) : data.pending.length === 0 ? (
            <EmptyCard
              icon={<Star className="size-6 fill-emerald-500 text-emerald-500" />}
              tone="bg-emerald-500/10"
              title={t('accountPage.feedback.allRatedTitle')}
              desc={t('accountPage.feedback.allRatedDesc')}
            />
          ) : (
            <>
              {data.pending.map((b) => (
                <PendingRideCard
                  key={b.id}
                  booking={b}
                  expanded={expandedId === b.id}
                  onToggle={() => setExpandedId(toggle(b.id, expandedId))}
                  onSubmitted={() => {
                    setExpandedId(null)
                    data.refetch()
                  }}
                />
              ))}
              <p className="px-1 text-xs text-muted-foreground">{t('accountPage.feedback.pendingHint')}</p>
            </>
          )}
        </TabsContent>

        <TabsContent value="sent" className="mt-4 space-y-3 outline-none">
          {data.reviewsLoading ? (
            Array.from({ length: 3 }, (_, i) => <SentFeedbackSkeleton key={i} />)
          ) : data.reviews.length === 0 ? (
            <EmptyCard
              icon={<MessageSquareHeart className="size-6 text-amber-500" />}
              tone="bg-amber-500/10"
              title={t('accountPage.feedback.emptySentTitle')}
              desc={t('accountPage.feedback.emptySentDesc')}
            />
          ) : (
            data.reviews.map((r) => (
              <SentFeedbackCard
                key={r.id}
                review={r}
                booking={r.bookingId ? data.bookingById.get(r.bookingId) : undefined}
                editing={editingId === r.id}
                onEdit={() => setEditingId(toggle(r.id, editingId))}
                onEdited={() => {
                  setEditingId(null)
                  data.refetch()
                }}
              />
            ))
          )}
          {data.total > PAGE_SIZE && (
            <FeedbackPager
              page={page}
              pageSize={PAGE_SIZE}
              total={data.total}
              busy={data.reviewsLoading}
              onPage={setPage}
            />
          )}
        </TabsContent>
      </Tabs>

      <div className="pt-1 text-center">
        <Link
          to="/account/trips"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          {t('accountPage.feedback.viewTrips')}
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
    </div>
  )
}
