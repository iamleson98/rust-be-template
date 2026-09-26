/** 404 Not Found route */
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Compass } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { buildSearchInput } from '@/lib/search-params'

export function NotFoundPage() {
  const t = useT()
  return (
    <div className="container mx-auto px-4 py-20 max-w-xl text-center">
      <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 mb-6">
        <Compass className="h-8 w-8 text-blue-500" />
      </div>
      <h1 className="text-3xl font-extrabold tracking-tight">{t('notFoundPage.title')}</h1>
      <p className="mt-3 text-muted-foreground">
        {t('notFoundPage.message')}
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Button asChild>
          <Link to="/">{t('notFound.backHome')}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/search" search={buildSearchInput({ from: '', to: '', date: '' })}>
            {t('search.btn')}
          </Link>
        </Button>
      </div>
    </div>
  )
}
