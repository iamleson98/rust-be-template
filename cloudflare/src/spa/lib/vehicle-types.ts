import { BedDouble, BedSingle, Bus, BusFront, CarFront, type LucideIcon } from 'lucide-react'
import { VEHICLE_TYPE_LABELS } from './labels'

/** The vehicle classes a search can filter on, in display order, with one icon and one name each. */
export const VEHICLE_TYPES: { key: string; labelKey: string; Icon: LucideIcon }[] = [
  { key: 'limousine', labelKey: VEHICLE_TYPE_LABELS.limousine, Icon: CarFront },
  { key: 'sleeper', labelKey: VEHICLE_TYPE_LABELS.sleeper, Icon: BedDouble },
  { key: 'semi_sleeper', labelKey: VEHICLE_TYPE_LABELS.semi_sleeper, Icon: BedSingle },
  { key: 'minivan', labelKey: VEHICLE_TYPE_LABELS.minivan, Icon: BusFront },
  { key: 'standard', labelKey: VEHICLE_TYPE_LABELS.standard, Icon: Bus },
]
