import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'

/** "1–8 of 20" with previous / next buttons (server-side pages). */
export function FeedbackPager({
  page,
  pageSize,
  total,
  busy,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  busy: boolean
  onPage: (page: number) => void
}) {
  const t = useT()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex items-center justify-between pt-1">
      <span className="text-xs text-muted-foreground">
        {t('accountPage.feedback.showing', {
          from: page * pageSize + 1,
          to: Math.min((page + 1) * pageSize, total),
          total,
        })}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          disabled={page === 0 || busy}
          onClick={() => onPage(page - 1)}
          aria-label={t('common.prevPage')}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          {page + 1} / {pages}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          disabled={page >= pages - 1 || busy}
          onClick={() => onPage(page + 1)}
          aria-label={t('common.nextPage')}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
