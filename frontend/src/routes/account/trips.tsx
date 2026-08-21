/**
 * Account route — `/account/trips` — purchase history + feedback.
 *
 * Shows the user's booking history with the ability to leave feedback
 * for completed trips. This is a convenience page under the /account
 * sidebar that wraps the existing MyBookings component.
 */
import { AccountShell } from '@/components/layout/account-shell'
import { MyBookings } from '@/components/bookings/my-bookings'

export function AccountTripsPage() {
  return (
    <AccountShell>
      <MyBookings />
    </AccountShell>
  )
}
