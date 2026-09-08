import { useState } from 'react'
import { MoonIcon, SunIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'

import { FeedbackSections } from './sections/feedback-sections'
import { FormSections } from './sections/form-sections'
import { NavigationSections } from './sections/navigation-sections'
import { OverlaySections } from './sections/overlay-sections'
import { SelectionSections } from './sections/selection-sections'
import { StaticSections } from './sections/static-sections'

const SECTIONS = [
  'badge',
  'alert',
  'card',
  'skeleton',
  'progress',
  'avatar',
  'separator',
  'table',
  'data-table',
  'breadcrumb',
  'aspect-ratio',
  'pagination',
  'button',
  'input',
  'textarea',
  'checkbox',
  'switch',
  'radio-group',
  'input-otp',
  'slider',
  'form',
  'dialog',
  'alert-dialog',
  'sheet',
  'drawer',
  'dropdown-menu',
  'popover',
  'tooltip',
  'hover-card',
  'context-menu',
  'tabs',
  'accordion',
  'collapsible',
  'scroll-area',
  'resizable',
  'menubar',
  'navigation-menu',
  'select',
  'combobox',
  'toggle',
  'toggle-group',
  'calendar',
  'date-picker',
  'time-picker',
  'infinite-select',
  'toast',
]

/**
 * The UI gallery — a dev-only showcase of every base component in
 * src/components/ui, wired with interactive state mirrors so
 * Playwright can verify behavior (see frontend/e2e/).
 *
 * Deliberately NOT part of the app's production bundle.
 *
 * Not shown here (documented exclusions):
 *  - sidebar.tsx     — composite app shell, needs SidebarProvider + router
 *  - toaster.tsx     — legacy Radix-API compat shim; the live toast
 *                      surface is sonner (tested via sec-toast)
 *  - slot.tsx        — internal utility (asChild), exercised indirectly
 *                      by every *Trigger asChild usage above
 */
export function Gallery() {
  const [dark, setDark] = useState(false)

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
  }

  return (
    <div className="bg-background text-foreground min-h-screen font-sans">
      {/* Non-sticky by design: a sticky header intercepts Playwright's
          auto-scroll clicks on far-below-the-fold sections. */}
      <header className="bg-background w-full border-b" data-testid="gallery-header">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              DatXeVui UI Component Gallery
            </h1>
            <p className="text-muted-foreground text-sm">
              {SECTIONS.length} base components · dev-only test harness
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground hidden text-xs sm:inline">
              Theme: <span data-testid="theme-label">{dark ? 'dark' : 'light'}</span>
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={toggleTheme}
              aria-label="Toggle dark mode"
              data-testid="theme-toggle"
            >
              {dark ? <SunIcon /> : <MoonIcon />}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-6 py-10">
        <StaticSections />
        <FormSections />
        <OverlaySections />
        <NavigationSections />
        <SelectionSections />
        <FeedbackSections />
      </main>

      <Toaster
        position="top-right"
        richColors
        closeButton
        data-testid="toaster"
      />
    </div>
  )
}
