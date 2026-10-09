# Seat pricing

What a ticket costs, who sets it, and where the rules live.

## Rules

- **Per schedule.** Each schedule prices its own seats, so the same vehicle
  can cost more on one route (or departure) than another.
- **Per seat class.** Seats get a class in the layout editor (`standard`,
  `premium`, `vip`, `bed_lower`, `bed_upper`, …). Standard seats, and any
  class without its own fare, cost the schedule's `basePriceAdult`; a
  `schedule_fare` row prices one other class.
- **Child tickets are each brand's own policy.** A brand that sells them sets
  an age limit (`childFare.maxAge`, 1–17) and a discount
  (`childFare.discountPercent`). A passenger up to that age pays the class's
  child price when the schedule sets one (`basePriceChild`, or `priceChild`
  on a class fare), and otherwise the adult price less the discount, rounded
  to the nearest 1,000 ₫. A child never pays more than an adult. A brand
  without a policy sells every seat at the adult price.
- **The server decides.** A booking sends each passenger's age and seat;
  the type a client claims is ignored. `service/fares.rs` holds every rule
  and the web client mirrors it only to show prices ahead
  (`features/booking/fares.ts`).

## Price changes

A trip snapshots each seat's adult price into `seat_inventory` when it is
created. Saving a schedule's fares, or re-classing seats in a layout,
re-prices the seats **still for sale** on that schedule's upcoming trips; held
and sold seats keep the price they were sold at, and every ticket stores its
own price in `booking_seat.price`.

## API

| | |
|---|---|
| `PUT /api/admin/brands/{id}` | `childFare: {maxAge, discountPercent}` turns child tickets on, `null` off, absent leaves them |
| `PUT /api/admin/schedules/{id}` | `basePriceAdult`, `basePriceChild` (0 = brand discount), `classFares: [{seatClass, priceAdult, priceChild?}]` replaces all class fares |
| `GET /api/admin/bus-layouts` | `seatClasses: [{seatClass, seats}]` per layout, for the fare editor |
| `GET /api/trips/{id}` | per seat `finalPrice` + `childPrice`; `pricing.fares` (one per class on the trip) and `pricing.childFare`; `trip.bookable` |
| `GET /api/search` | `minPrice` / `maxPrice` = cheapest / dearest seat still for sale |
| `POST /api/bookings` | passengers carry `age` and `seatId`; stops are required only when the route has pickup points |

## Code map

- Backend: `service/fares.rs` (rules + re-pricing), `entity/schedule_fare.rs`,
  `dto/fares.rs`, migration `m20261009_000018_add_seat_class_fares`;
  tests in `service/fares.rs` and `service/pricing_tests.rs`.
- Admin UI: `features/admin/schedules/schedule-fares.tsx`, the child-ticket
  section of `features/admin/brands/brand-form.tsx`.
- Customer UI: `features/seat-plan/seat-map.tsx` (prices on picked seats,
  fare legend), `features/trips/trip-detail-dialog/` (seat chips, fares
  table), `features/booking/flow/use-booking-form.ts` (ticket per passenger).
