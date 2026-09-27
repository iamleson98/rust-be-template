/** Account route — `/account` (the user's console home) */
import { UserConsole } from '@/features/account/user-console'

export function AccountPage() {
  return (
    <div className="page-transition">
      <UserConsole />
    </div>
  )
}
