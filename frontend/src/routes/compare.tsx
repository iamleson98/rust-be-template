/** Compare route — `/compare`
 *
 * Standalone deep-linkable page for the trip-compare table. Renders the
 * compare component in `inline` mode (in-flow panel instead of the
 * overlay) — previously this page rendered a permanently blank screen
 * whenever it was opened via URL/reload instead of the compare tray.
 */
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TripCompare } from '@/features/search/trip-compare'
import { useT } from '@/lib/i18n'

export function ComparePage() {
  const t = useT()
  return (
    <div className="page-transition">
      <div className="container mx-auto px-4 py-6">
        <Button variant="ghost" size="sm" asChild className="gap-1.5 mb-4 text-muted-foreground hover:text-foreground">
          <Link to="/search">
            <ArrowLeft className="h-4 w-4" />
            {t('common.back')}
          </Link>
        </Button>
        <TripCompare inline />
      </div>
    </div>
  )
}
