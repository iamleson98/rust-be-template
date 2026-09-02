import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { Section } from '../section'

/**
 * Feedback base components: the sonner Toaster (the app's real toast
 * surface — see App.tsx) + toast trigger demos.
 */
export function FeedbackSections() {
  return (
    <Section
      id="toast"
      title="Toast (sonner)"
      description="Transient notifications: success, error, info, auto-dismiss."
    >
      <div className="flex flex-wrap gap-3">
        <Button
          data-testid="toast-btn-success"
          onClick={() => toast.success('Booking confirmed!', {
            description: 'Seat 12A held — check your email.',
          })}
        >
          Success toast
        </Button>
        <Button
          variant="destructive"
          data-testid="toast-btn-error"
          onClick={() => toast.error('Payment failed', {
            description: 'Your card was declined. Try another method.',
          })}
        >
          Error toast
        </Button>
        <Button
          variant="outline"
          data-testid="toast-btn-info"
          onClick={() =>
            toast('Driver is arriving in 5 minutes', {
              description: 'Bus 51B-123.45 · white Phương Trang sleeper',
            })
          }
        >
          Info toast
        </Button>
        <Button
          variant="ghost"
          data-testid="toast-btn-auto"
          onClick={() =>
            toast('This toast self-destructs', { duration: 1200 })
          }
        >
          Auto-dismiss (1.2s)
        </Button>
      </div>
    </Section>
  )
}
