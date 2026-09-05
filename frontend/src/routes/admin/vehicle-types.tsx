/** Admin route — `/admin/vehicle-types` — vehicle type catalog management. */
import { VehicleTypesPanel } from '@/components/admin/vehicle-types/vehicle-types-panel'

export function AdminVehicleTypesPage() {
  return (
    <div className="page-transition">
      <VehicleTypesPanel />
    </div>
  )
}
