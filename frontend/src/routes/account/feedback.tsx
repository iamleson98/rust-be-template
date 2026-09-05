/**
 * Account route — `/account/feedback` — the user's feedback surface.
 *
 * Persistent AccountShell comes from the router's account layout route;
 * this file renders the feedback content into the shell's outlet.
 */
import { AccountFeedbackContent } from '@/components/account/feedback-content'

export function AccountFeedbackPage() {
  return (
    <div className="page-transition">
      <AccountFeedbackContent />
    </div>
  )
}
