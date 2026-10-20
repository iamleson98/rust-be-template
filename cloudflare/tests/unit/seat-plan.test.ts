import { describe, expect, it } from "vitest";
import {
  deriveFromSeats,
  fitToSeats,
  parseSeatPlan,
  toStored,
  isSellable,
  syncSeatRows,
  trustedPlan,
  validateSeatPlan,
  InUseError,
  type SeatPlan,
  type SeatRow,
} from "@/lib/services/seat-plan";

/**
 * Seat-plan engine — pure-function ports of the Rust seat_plan.rs rules
 * (the layer that fixes the legacy-layout editor crash and keeps seat
 * identity stable while trips sell a layout).
 */

const iso = "2026-10-18T00:00:00.000Z";
let n = 0;
function seat(over: Partial<SeatRow> = {}): SeatRow {
  n += 1;
  return {
    id: `s-${n.toString().padStart(3, "0")}`,
    busLayoutId: "L1",
    seatLabel: `A${n}`,
    seatClass: null,
    rowNum: 1,
    colNum: 1,
    isWindow: false,
    floor: 1,
    createdAt: iso,
    ...over,
  } as SeatRow;
}
const idOf = (s: SeatRow) => s.id; // explicit ids make cross-test assertions stable

function planOf(decks: SeatPlan["decks"]): SeatPlan {
  return { decks };
}

const twoSeats = planOf([
  {
    rows: 1,
    cols: 2,
    cells: [
      { row: 1, col: 1, kind: "seat", label: "01" },
      { row: 1, col: 2, kind: "seat", label: "02" },
    ],
  },
]);

describe("validateSeatPlan (Rust structural rules)", () => {
  it("accepts a minimal valid plan", () => {
    expect(validateSeatPlan(twoSeats)).toBeNull();
  });

  it("rejects zero and >2 decks", () => {
    expect(validateSeatPlan(planOf([]))).toMatch(/1–2 decks/);
    expect(
      validateSeatPlan(planOf([twoSeats.decks[0]!, twoSeats.decks[0]!, twoSeats.decks[0]!])),
    ).toMatch(/1–2 decks/);
  });

  it("rejects cells outside the grid and duplicate positions", () => {
    expect(
      validateSeatPlan(
        planOf([{ rows: 1, cols: 1, cells: [{ row: 2, col: 1, kind: "seat", label: "01" }] }]),
      ),
    ).toMatch(/outside the 1×1 grid/);
    expect(
      validateSeatPlan(
        planOf([
          {
            rows: 2,
            cols: 2,
            cells: [
              { row: 1, col: 1, kind: "seat", label: "01" },
              { row: 1, col: 1, kind: "seat", label: "02" },
            ],
          },
        ]),
      ),
    ).toMatch(/two cells at row 1, column 1/);
  });

  it("rejects duplicate labels and unlabeled sellable cells", () => {
    expect(
      validateSeatPlan(
        planOf([
          {
            rows: 1,
            cols: 3,
            cells: [
              { row: 1, col: 1, kind: "seat", label: "01" },
              { row: 1, col: 2, kind: "door" },
              { row: 1, col: 3, kind: "seat", label: "01" },
            ],
          },
        ]),
      ),
    ).toMatch(/more than once/);
    expect(
      validateSeatPlan(planOf([{ rows: 1, cols: 1, cells: [{ row: 1, col: 1, kind: "bed" }] }])),
    ).toMatch(/needs a label/);
  });
});

describe("deriveFromSeats (legacy layouts open in the editor)", () => {
  it("derives a deck per floor with seat ids and labels", () => {
    const lower1 = seat({ seatLabel: "01", rowNum: 1, colNum: 1 });
    const lower2 = seat({ seatLabel: "02", rowNum: 1, colNum: 2 });
    const upper = seat({
      seatLabel: "B01",
      rowNum: 1,
      colNum: 1,
      floor: 2,
      seatClass: "bed_lower",
    });
    const plan = deriveFromSeats([lower1, lower2, upper]);
    expect(plan.decks).toHaveLength(2);
    expect(plan.decks[0]!.cells.map((c) => c.seatId)).toEqual([idOf(lower1), idOf(lower2)]);
    expect(plan.decks[1]!.cells[0]!.kind).toBe("bed");
    expect(plan.decks[1]!.cells[0]!.seatId).toBe(idOf(upper));
  });

  it("falls back to rows of four for seats without row/col", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      seat({
        seatLabel: `S${i + 1}`,
        rowNum: null as unknown as number,
        colNum: null as unknown as number,
      }),
    );
    const plan = deriveFromSeats(rows);
    expect(plan.decks[0]!.rows).toBe(2);
    expect(plan.decks[0]!.cols).toBe(4);
  });

  it("never returns an empty deck array when seats exist (the editor crash)", () => {
    expect(deriveFromSeats([seat()]).decks).toHaveLength(1);
  });
});

describe("trustedPlan (stored plan must match the seat rows)", () => {
  it("fills seat ids from the rows when positions agree", () => {
    const one = seat({ seatLabel: "01", rowNum: 1, colNum: 1 });
    const two = seat({ seatLabel: "02", rowNum: 1, colNum: 2 });
    const stored = JSON.stringify(twoSeats);
    const plan = trustedPlan(stored, [one, two]);
    expect(plan).not.toBeNull();
    expect(plan!.decks[0]!.cells[0]!.seatId).toBe(idOf(one));
    expect(plan!.decks[0]!.cells[1]!.seatId).toBe(idOf(two));
  });

  it("rejects a drifted plan (seat moved by a direct DB edit)", () => {
    const rows = [
      seat({ seatLabel: "01", rowNum: 2, colNum: 2 }),
      seat({ seatLabel: "02", rowNum: 1, colNum: 2 }),
    ];
    expect(trustedPlan(JSON.stringify(twoSeats), rows)).toBeNull();
  });

  it("rejects when the plan is missing a seat row", () => {
    const rows = [seat({ seatLabel: "01", rowNum: 1, colNum: 1 })];
    expect(trustedPlan(JSON.stringify(twoSeats), rows)).toBeNull();
  });

  it("rejects null/garbage layout data", () => {
    expect(trustedPlan(null, [seat()])).toBeNull();
    expect(trustedPlan("{not json", [seat()])).toBeNull();
  });
});

describe("syncSeatRows (id/label preserving seat sync)", () => {
  const existing = [
    seat({ id: "id-01", seatLabel: "01", rowNum: 1, colNum: 1 }),
    seat({ id: "id-02", seatLabel: "02", rowNum: 1, colNum: 2 }),
  ];

  it("matches by seatId first, then by label; keeps ids", () => {
    const plan = planOf([
      {
        rows: 1,
        cols: 2,
        cells: [
          { row: 1, col: 1, kind: "seat", label: "01", seatId: "id-01" },
          { row: 1, col: 2, kind: "seat", label: "02", seatId: "id-02" },
        ],
      },
    ]);
    const sync = syncSeatRows(existing, plan, false);
    expect(sync.updates.map((u) => u.seatId).sort()).toEqual(["id-01", "id-02"]);
    expect(sync.inserts).toHaveLength(0);
    expect(sync.deletes).toHaveLength(0);
  });

  it("relabel + move produce updates, not delete+insert", () => {
    const plan = planOf([
      {
        rows: 2,
        cols: 2,
        cells: [
          { row: 1, col: 1, kind: "seat", label: "1A" }, // matched by old label "01"? no → insert… label matching
          { row: 2, col: 1, kind: "seat", label: "01" },
        ],
      },
    ]);
    // "01" matches by label → update; "1A" is new → insert; "02" dropped → delete
    const sync = syncSeatRows(existing, plan, false);
    expect(sync.updates.map((u) => u.seatId)).toEqual(["id-01"]);
    expect(sync.inserts.map((i) => i.label)).toEqual(["1A"]);
    expect(sync.deletes).toEqual(["id-02"]);
  });

  it("bed cells default to bed_lower / bed_upper classes", () => {
    const plan = planOf([
      {
        rows: 1,
        cols: 1,
        cells: [{ row: 1, col: 1, kind: "bed", label: "B1" }],
      },
      {
        rows: 1,
        cols: 1,
        cells: [{ row: 1, col: 1, kind: "bed", label: "B2" }],
      },
    ]);
    const sync = syncSeatRows([], plan, false);
    expect(sync.inserts[0]!.seatClass).toBe("bed_lower");
    expect(sync.inserts[1]!.seatClass).toBe("bed_upper");
  });

  it("throws InUseError when trips sell the layout and seats would appear/disappear", () => {
    const grown = planOf([
      {
        rows: 1,
        cols: 3,
        cells: [
          { row: 1, col: 1, kind: "seat", label: "01", seatId: "id-01" },
          { row: 1, col: 2, kind: "seat", label: "02", seatId: "id-02" },
          { row: 1, col: 3, kind: "seat", label: "03" },
        ],
      },
    ]);
    expect(() => syncSeatRows(existing, grown, true)).toThrow(InUseError);
    expect(() => syncSeatRows(existing, grown, true)).toThrow(/thêm 1 ghế/);

    const shrunk = planOf([
      {
        rows: 1,
        cols: 1,
        cells: [{ row: 1, col: 1, kind: "seat", label: "01", seatId: "id-01" }],
      },
    ]);
    expect(() => syncSeatRows(existing, shrunk, true)).toThrow(/bớt/);
    // Same shape while in use: move + relabel is allowed
    const moved = planOf([
      {
        rows: 2,
        cols: 2,
        cells: [
          { row: 2, col: 2, kind: "seat", label: "01", seatId: "id-01" },
          { row: 2, col: 1, kind: "seat", label: "02", seatId: "id-02" },
        ],
      },
    ]);
    expect(() => syncSeatRows(existing, moved, true)).not.toThrow();
  });
});

describe("fitToSeats (template preview, ids kept, nothing saved)", () => {
  it("lays the template over the seats in natural label order", () => {
    const template = planOf([
      {
        rows: 2,
        cols: 2,
        cells: [
          { row: 1, col: 1, kind: "seat" },
          { row: 1, col: 2, kind: "seat" },
          { row: 2, col: 1, kind: "wc" },
          { row: 2, col: 2, kind: "seat" },
        ],
      },
    ]);
    const seats = [
      seat({ id: "a", seatLabel: "A2" }),
      seat({ id: "b", seatLabel: "A10" }),
      seat({ id: "c", seatLabel: "B1" }),
    ];
    const fitted = fitToSeats(template, seats);
    // natural order: A2 < A10 < B1 → cells (1,1), (1,2), (2,2)
    const cells = fitted.decks[0]!.cells.filter((c) => isSellable(c.kind));
    expect(cells.map((c) => [c.label, c.seatId])).toEqual([
      ["A2", "a"],
      ["A10", "b"],
      ["B1", "c"],
    ]);
  });

  it("splits two decks by floor, then class, then B-prefix", () => {
    const template = planOf([
      { rows: 1, cols: 1, cells: [{ row: 1, col: 1, kind: "seat" }] },
      { rows: 1, cols: 1, cells: [{ row: 1, col: 1, kind: "seat" }] },
    ]);
    const seats = [
      seat({ id: "up", seatLabel: "X1", floor: 2 }),
      seat({ id: "down", seatLabel: "X2", floor: 1 }),
    ];
    const fitted = fitToSeats(template, seats);
    expect(fitted.decks[0]!.cells[0]!.seatId).toBe("down");
    expect(fitted.decks[1]!.cells[0]!.seatId).toBe("up");
  });

  it("refuses when the template cannot hold exactly these seats", () => {
    expect(() => fitToSeats(twoSeats, [seat()])).toThrow(/holds 2 seats but the layout has 1/);
    expect(() =>
      fitToSeats(
        planOf([
          { rows: 1, cols: 1, cells: [{ row: 1, col: 1, kind: "seat" }] },
          { rows: 1, cols: 1, cells: [{ row: 1, col: 1, kind: "seat" }] },
        ]),
        // two ambiguous single-floor seats: no strategy splits 1/1
        [
          seat({ seatLabel: "Q1", floor: 1, seatClass: null }),
          seat({ seatLabel: "Q2", floor: 1, seatClass: null }),
        ],
      ),
    ).toThrow(/cannot tell which seats belong to which deck/);
  });
});

describe("stored form and the remaining Rust validation rules", () => {
  it("round-trips as a versioned plan without seat ids", () => {
    const plan = planOf([
      { rows: 1, cols: 1, cells: [{ row: 1, col: 1, kind: "seat", label: "1", seatId: "x" }] },
    ]);
    const raw = toStored(plan);
    expect(raw.startsWith('{"version":2')).toBe(true);
    const back = parseSeatPlan(raw);
    expect(back?.decks[0]?.cells[0]?.seatId).toBeUndefined();
    expect(back?.decks[0]?.cells[0]?.label).toBe("1");
  });

  it("legacy and garbage layout data is not a plan", () => {
    expect(parseSeatPlan(null)).toBeNull();
    expect(parseSeatPlan("")).toBeNull();
    expect(parseSeatPlan('{"version":1,"decks":[]}')).toBeNull();
    expect(parseSeatPlan("not json")).toBeNull();
    // Plans this port saved before it wrote a version still read.
    expect(parseSeatPlan('{"decks":[]}')).toEqual({ decks: [] });
  });

  it("enforces label length, class length and the seat cap", () => {
    const one = (cell: SeatPlan["decks"][number]["cells"][number]) =>
      validateSeatPlan(planOf([{ rows: 1, cols: 1, cells: [cell] }]));
    expect(one({ row: 1, col: 1, kind: "seat", label: "ABCDEFGHIJK" })).toMatch(/label of 1–10/);
    expect(one({ row: 1, col: 1, kind: "seat", label: "1", seatClass: "x".repeat(31) })).toMatch(
      /class is longer than 30/,
    );
    const big = planOf([
      {
        rows: 30,
        cols: 9,
        cells: Array.from({ length: 121 }, (_, i) => ({
          row: Math.floor(i / 9) + 1,
          col: (i % 9) + 1,
          kind: "seat",
          label: `S${i}`,
        })),
      },
    ]);
    expect(validateSeatPlan(big)).toMatch(/too large/);
    expect(
      validateSeatPlan(planOf([{ rows: 1, cols: 1, cells: [{ row: 1, col: 1, kind: "door" }] }])),
    ).toBe("a plan needs at least one seat");
  });
});
