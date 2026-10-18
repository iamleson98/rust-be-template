/** Trip-detail helpers shared by the trip API + booking flow. */

export interface SellWindow {
  bookable: boolean;
  reason?: string;
}

export function ensureSaleWindow(departureDate: string): SellWindow {
  const dep = new Date(`${departureDate}T23:59:59Z`).getTime();
  if (Date.now() > dep) return { bookable: false, reason: "departed" };
  const daysOut = (dep - Date.now()) / 86_400_000;
  if (daysOut > 14) return { bookable: false, reason: "beyond-14-days" };
  return { bookable: true };
}
