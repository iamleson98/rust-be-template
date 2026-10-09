import { useState } from 'react'
import { Clock, MessageSquareHeart, Star } from 'lucide-react'
import { ConsolePage, PageHeader } from '@/components/console/page'
import { EmptyState, Panel } from '@/components/console/panel'
import { PillTab, PillTabs } from '@/components/console/pill-tabs'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { useT } from '@/lib/i18n'
import { FeedbackPager } from './feedback-pager'
import { PendingRideCard, PendingRideSkeleton } from './pending-ride-card'
import { SentFeedbackCard, SentFeedbackSkeleton } from './sent-feedback-card'
import { PAGE_SIZE, useFeedbackData } from './use-feedback-data'

/** Nothing to show in a tab: what it means and that it is fine. */
function EmptyCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Panel>
      <EmptyState
        icon={icon}
        text={
          <>
            <span className="block font-medium text-foreground">{title}</span>
            {desc}
          </>
        }
      />
    </Panel>
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

  const toggle = (id: string | null, current: string | null) => (id === current ? null : id)

  return (
    <ConsolePage>
      <PageHeader
        title={t('accountPage.feedback.heroTitle')}
        description={t('accountPage.feedback.heroDesc')}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'pending' | 'sent')} className="gap-4">
        <PillTabs>
          <PillTab
            value="pending"
            icon={<Clock />}
            label={t('accountPage.feedback.tabPending')}
            count={data.pending.length}
          />
          <PillTab
            value="sent"
            icon={<Star />}
            label={t('accountPage.feedback.tabSent')}
            count={data.total}
          />
        </PillTabs>

        <TabsContent value="pending" className="space-y-3 outline-none">
          {data.ridesLoading ? (
            Array.from({ length: 3 }, (_, i) => <PendingRideSkeleton key={i} />)
          ) : data.pending.length === 0 ? (
            <EmptyCard
              icon={<Star />}
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
              <p className="px-1 text-xs text-muted-foreground">
                {t('accountPage.feedback.pendingHint')}
              </p>
            </>
          )}
        </TabsContent>

        <TabsContent value="sent" className="space-y-3 outline-none">
          {data.reviewsLoading ? (
            Array.from({ length: 3 }, (_, i) => <SentFeedbackSkeleton key={i} />)
          ) : data.reviews.length === 0 ? (
            <EmptyCard
              icon={<MessageSquareHeart />}
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
    </ConsolePage>
  )
}
