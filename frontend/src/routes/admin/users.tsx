/** Admin route — `/admin/users` (ADMIN-only, guarded via router beforeLoad).
 *
 * Role management for the three-role model. Employees are redirected to
 * the dashboard; the backend additionally enforces the
 * `admin:users:manage-roles` permission on the PATCH endpoint.
 */
import { UsersPanel } from '@/components/admin/users/users-panel'

export function AdminUsersPage() {
  return (
    <div className="page-transition">
      <UsersPanel />
    </div>
  )
}
