# Seat layouts

How a vehicle's seat map is modelled, edited and rolled out. Written after the
2026-10 overhaul: before it, a layout was a rectangular `rows × cols × floors`
grid — a 42-bed sleeper was *one* deck of 21 rows × 2 columns, every deck drew
a driver, and there were no aisles, rear benches, doors or toilets.

## Model

A **seat plan** is one uniform grid per deck (1 or 2 decks).

- Row 1 is the **front**; column 1 is the **driver's side** (left in Vietnam,
  with the door on the right).
- An unoccupied cell is an aisle or a gap — "3 beds, 2 aisles" is
  `[bed · bed · bed]` on a 5-column grid; a rear bench of five is five beds in
  the last row.
- Cells are *sellable* (`seat`, `bed`, `cabin`, `cabin_double` — each backed by
  one `seat` row) or *fixtures* (`driver`, `door`, `stairs`, `wc` — drawn only).
- Sellable cells carry a customer-facing `label` (≤ 10 chars, unique per
  layout) and an optional `seatClass` (`standard`, `premium`, `vip`,
  `bed_lower`, `bed_upper`; berths default to lower/upper by deck).

Limits (mirrored in `frontend/src/features/seat-plan/model.ts`): 2 decks,
30 rows × 9 columns, 120 seats.

### Storage

No schema change. The plan is JSON in `bus_layout.layout_data`
(`{"version":2,"decks":[…]}`); the `seat` table stays the operational truth —
trips (`seat_inventory`) and tickets (`booking_seat`) reference its ids.
A stored plan is **trusted only while it matches the seat rows** (same labels,
decks and cells); otherwise the layout is treated as legacy and a plain grid is
derived from the rows. Trip detail then falls back to the old rendering.

### In use = frozen seat set

Once a layout has trip inventory or sold tickets, a plan change may *move*,
*relabel* and *re-class* seats but never add or remove one (409). Seats are
matched to cells by `seatId`, then by label, and keep their ids; relabels are
applied in two phases inside one transaction so swaps never trip
`UNIQUE(bus_layout_id, seat_label)`.

## API

| | |
|---|---|
| `GET /api/admin/bus-layouts/presets` | the template catalog (below) |
| `GET /api/admin/bus-layouts/{id}` | plan + `planned` + `inUse` (legacy layouts get a derived grid, `planned=false`) |
| `POST /api/admin/bus-layouts` | create from `plan` (wins) or the old `seatGrid` |
| `PUT /api/admin/bus-layouts/{id}/plan` | replace the plan (rules above) |
| `POST /api/admin/bus-layouts/{id}/plan/fit` `{presetId}` | preview a template laid over the layout's existing seats — ids and labels kept; saves nothing |
| `GET /api/trips/{id}` | `seatMap.decks[].plan {name, rows, cols, fixtures}` and `seat.kind` (absent for legacy layouts) |

## Templates

Generated in Rust (`service/seat_plan_presets.rs`) — one source of truth for the
admin gallery and for the backfill. Cells are numbered front → rear, left → right
(`01…` single deck, `A01…` lower / `B01…` upper).

| id | vehicle | layout |
|---|---|---|
| `car_4`, `car_7` | sedan / MPV | front passenger + rear benches (4 / 6 passengers) |
| `limo_9`, `limo_11` | limousine van | 2 seats beside the driver, rows of 1 + aisle + 1, rear bench of 3 |
| `minibus_15` | "16-seat" minibus | 2 beside the driver, rows of 2+1, rear bench of 4 |
| `seat_29`, `seat_45` | seater coach | rows of 2+2 around an aisle, rear bench of 5 |
| `sleeper_38_wc/40/42/44/46` | double-deck sleeper | 3 lanes, 2 aisles; per deck 5×3 + rear 5 (40), 7×3 (42), 6×3 + rear 4 (44), 6×3 + rear 5 (46), 5×3 + rear 4 with a toilet (38) |
| `sleeper_<n>` (even, 30–50) | any other sleeper | the same rule: full rows of 3 plus a rear bench of 4 or 5 |
| `limo_bed_34` | limousine bed coach | 3 lanes of 6 · 5 · 6 beds per deck |
| `cabin_24`, `cabin_22`, `cabin_22_double` | cabin limousine | 2 lanes + 1 aisle; 12+12, 10 + WC / 12, or 11+11 with a double cabin at the rear of the lower deck |

The driver is drawn on the lower deck only; the upper deck shows the stair
opening where the door is below.

## Rolling out to existing data

Imported layouts are flat grids. `layouts-normalize` lays the matching template
over each one — **seat ids and labels are untouched**, so trips, tickets and
customers' bookings keep working; only positions, decks and fixtures change.

```bash
backend layouts-normalize           # dry run: prints what would change
backend layouts-normalize --apply   # writes (one transaction per layout)
```

A layout is matched on seat count, name and vehicle type (40 plain seats are
not a sleeper; `WC` / `đôi` in the name select those variants). Anything that
does not match, or whose seats the template cannot hold exactly, is reported and
left alone — open it in the admin editor and use **Apply template** (same
engine) or draw it. Back up the database first; the command is idempotent.

## Code map

- Backend: `dto/seat_plan.rs`, `service/seat_plan*.rs`,
  `service/admin_service/bus_layouts.rs`, `routes/admin/bus_layouts.rs`,
  `cli/commands/layouts_normalize.rs`; tests in `tests/bus_layouts_admin.rs`.
- Frontend: `features/seat-plan/` (renderer `SeatMap`, `PlanEditor`,
  `PresetPicker`) and `features/admin/bus-layouts/` (create/edit dialog).

## Conventions researched

Vietnamese coaches: driver front-left, door front-right with stairs beside it;
sleepers run 3 lanes with 2 aisles, `A` = tầng 1 (lower) / `B` = tầng 2, a rear
bench of 4–5 without curtains, and an optional toilet at the rear; cabin
limousines run 2 lanes + 1 aisle with 11–12 cabins per deck and doubles near
the rear; limousine vans 9–22 seats in rows of 1+1 or 2+1 with a rear bench.
Sources: xesaigon.vn, thuexelimousines.com.vn, vietnamtourism.com,
saigonthanhcong.com, plus the live catalogue's own layout names.
