/** Account route — `/account` (user profile + settings) */
import { ProfileContent } from '@/components/account/profile-content'

export function AccountPage() {
  return (
    <div className="page-transition">
      <ProfileContent />
    </div>
  )
}
