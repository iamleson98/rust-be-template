/** Account route — `/account` (user profile + settings) */
import { AccountShell } from '@/components/layout/account-shell'
import { ProfileContent } from '@/components/account/profile-content'

export function AccountPage() {
  return (
    <AccountShell>
      <ProfileContent />
    </AccountShell>
  )
}
