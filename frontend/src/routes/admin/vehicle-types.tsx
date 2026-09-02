/** Admin route — `/admin/vehicle-types` — vehicle type catalog management. */
import { AdminShell } from '@/components/layout/admin-shell'
import { VehicleTypesPanel } from '@/components/admin/vehicle-types/vehicle-types-panel'

export function AdminVehicleTypesPage() {
  return (
    <AdminShell>
      <VehicleTypesPanel />
    </AdminShell>
  )
}
