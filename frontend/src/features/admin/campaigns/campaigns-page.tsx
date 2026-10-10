/**
 * Admin — discount campaigns (`/admin/campaigns`, admins only).
 *
 * Campaigns: each one's state, tiers and money position, with create / edit
 * in a side sheet, pause / resume, and delete while nobody has claimed.
 * Review & payouts: what is owed to each operator for trips made with a
 * coupon, and the coupons to check and mark paid (see `docs/CAMPAIGNS.md`).
 */
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, Plus, RefreshCw, TicketPercent, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import {
  adminCampaignsDeleteMutation,
  adminCampaignsListOptions,
  adminCampaignsUpdateMutation,
  type AdminCampaignOut,
} from '@/api'
import { ConsolePage, PageHeader } from '@/components/console/page'
import { EmptyState } from '@/components/console/panel'
import { PillTab, PillTabs } from '@/components/console/pill-tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { ErrorState } from '@/components/error-state'
import { getErrorMessage } from '@/lib/error-message'
import { useT } from '@/lib/i18n'
import { CampaignCard } from './campaign-card'
import { CampaignEditor, type EditorTarget } from './campaign-editor'
import { inputFrom } from './form'
import { PayoutsPanel } from './payouts-panel'

/** Running first, then upcoming, paused, ended; newest window first within each. */
const ORDER: Record<string, number> = { running: 0, upcoming: 1, paused: 2, ended: 3 }

export function CampaignsPage() {
  const t = useT()
  const [tab, setTab] = useState<'campaigns' | 'payouts'>('campaigns')
  const [editing, setEditing] = useState<EditorTarget | null>(null)
  const [deleting, setDeleting] = useState<AdminCampaignOut | null>(null)
  const query = useQuery(adminCampaignsListOptions())
  const update = useMutation(adminCampaignsUpdateMutation())
  const remove = useMutation(adminCampaignsDeleteMutation())

  const campaigns = [...(query.data?.items ?? [])].sort(
    (a, b) => (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9) || b.startsAt.localeCompare(a.startsAt),
  )
  const owed = campaigns.reduce((n, c) => n + c.totals.owedCount, 0)

  const open = (campaign: AdminCampaignOut | null) =>
    setEditing({ campaign, now: Date.now(), nonce: Date.now() })

  const togglePause = (c: AdminCampaignOut) =>
    update.mutate(
      { path: { id: c.id }, body: inputFrom(c, { paused: !c.paused }) },
      {
        onSuccess: () =>
          toast.success(c.paused ? t('adminCampaigns.resumed') : t('adminCampaigns.paused')),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    )

  const confirmDelete = () => {
    if (!deleting) return
    remove.mutate(
      { path: { id: deleting.id } },
      {
        onSuccess: () => {
          toast.success(t('adminCampaigns.deleted'))
          setDeleting(null)
        },
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    )
  }

  return (
    <ConsolePage>
      <PageHeader
        title={t('adminCampaigns.title')}
        description={t('adminCampaigns.subtitle')}
        actions={
          <>
            <Button
              variant="outline"
              size="icon"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              aria-label={t('common.refresh')}
            >
              <RefreshCw className={query.isFetching ? 'animate-spin' : undefined} />
            </Button>
            <Button onClick={() => open(null)}>
              <Plus />
              {t('adminCampaigns.new')}
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="gap-5">
        <PillTabs>
          <PillTab
            value="campaigns"
            icon={<TicketPercent />}
            label={t('adminCampaigns.tabCampaigns')}
            count={campaigns.length}
          />
          <PillTab
            value="payouts"
            icon={<Wallet />}
            label={t('adminCampaigns.tabPayouts')}
            count={owed}
          />
        </PillTabs>

        <TabsContent value="campaigns" className="outline-none">
          {query.isLoading ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-64 rounded-2xl" />
              ))}
            </div>
          ) : query.isError ? (
            <ErrorState onRetry={() => query.refetch()} />
          ) : campaigns.length === 0 ? (
            <EmptyState
              icon={<TicketPercent />}
              text={t('adminCampaigns.empty')}
              action={
                <Button onClick={() => open(null)}>
                  <Plus />
                  {t('adminCampaigns.new')}
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {campaigns.map((c) => (
                <CampaignCard
                  key={c.id}
                  campaign={c}
                  busy={update.isPending}
                  onEdit={() => open(c)}
                  onTogglePause={() => togglePause(c)}
                  onDelete={() => setDeleting(c)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="payouts" className="outline-none">
          <PayoutsPanel />
        </TabsContent>
      </Tabs>

      <CampaignEditor target={editing} onClose={() => setEditing(null)} />

      <AlertDialog
        open={!!deleting}
        onOpenChange={(o) => !o && !remove.isPending && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('adminCampaigns.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-semibold text-foreground">{deleting?.name}</span> —{' '}
              {t('adminCampaigns.deleteDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              className="bg-rose-600 hover:bg-rose-700"
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
            >
              {remove.isPending ? <Loader2 className="animate-spin" /> : t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConsolePage>
  )
}
