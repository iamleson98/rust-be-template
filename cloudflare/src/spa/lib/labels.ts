/** i18n keys (not display text) — resolve with `t(VEHICLE_TYPE_LABELS[x] ?? x)`. */
export const VEHICLE_TYPE_LABELS: Record<string, string> = {
  limousine: 'types.vehicleLimousine',
  sleeper: 'types.vehicleSleeper',
  semi_sleeper: 'types.vehicleSemiSleeper',
  standard: 'types.vehicleStandard',
  minivan: 'types.vehicleMinivan',
}

export const SEAT_CLASS_LABELS: Record<string, string> = {
  standard: 'types.seatStandard',
  premium: 'types.seatPremium',
  vip: 'types.seatVip',
  bed_lower: 'types.seatBedLower',
  bed_upper: 'types.seatBedUpper',
}

export const SEAT_CLASS_COLORS: Record<string, string> = {
  standard: '#64748b',
  premium: '#2563eb',
  vip: '#7c3aed',
  bed_lower: '#1d4ed8',
  bed_upper: '#3b82f6',
}

export const AMENITY_LABELS: Record<string, string> = {
  window: 'types.amenityWindow',
  legroom: 'types.amenityLegroom',
  recline: 'types.amenityRecline',
  curtain: 'types.amenityCurtain',
  charging: 'types.amenityCharging',
  wifi: 'types.amenityWifi',
  ac: 'types.amenityAc',
  water: 'types.amenityWater',
}
