import { getDb } from "@/lib/db/client";
import { busLayouts } from "@/lib/db/schema";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminBusLayoutList, type SeatPlan } from "@/lib/services/admin-out";
import { replaceSeatPlan, validateSeatPlan } from "@/lib/services/seat-plan";

/** `GET /api/admin/bus-layouts?brandId=&limit=&offset=` — staff list (slim). */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:bus_layouts:read");
    const url = new URL(req.url);
    const result = await adminBusLayoutList({
      brandId: url.searchParams.get("brandId") ?? undefined,
      limit: Math.min(
        Math.max(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 1),
        500,
      ),
      offset: Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0),
    });
    return Response.json(result);
  } catch (e) {
    return handleRouteError(e);
  }
}

interface LayoutBody {
  brandId?: string;
  name?: string;
  vehicleType?: string;
  totalSeats?: number;
  layoutData?: string;
  plan?: SeatPlan | null;
  seatGrid?: { rows?: number; cols?: number; floors?: number } | null;
}

/** `POST /api/admin/bus-layouts` — create a layout (plan > seatGrid). */
export async function POST(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:bus_layouts:write");
    const body = await readJson<LayoutBody>(req);
    const name = (body.name ?? "").trim();
    if (!name) return err(400, "validation", "name is required");
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    let plan: SeatPlan | null = body.plan ?? null;
    if (!plan && body.seatGrid) plan = gridToPlan(body.seatGrid);
    // Structural validation up front — the same rules the editor enforces.
    if (plan) {
      const invalid = validateSeatPlan(plan);
      if (invalid) return err(400, "validation", invalid);
    }

    await db.insert(busLayouts).values({
      id,
      brandId: body.brandId?.trim() || null,
      name,
      vehicleType: body.vehicleType ?? null,
      totalSeats: body.totalSeats ?? null,
      layoutData: plan ? JSON.stringify(plan) : (body.layoutData ?? null),
      createdAt: now,
      updatedAt: now,
    });
    // Seat rows for every sellable cell (seat/bed/cabin/…), ids stable
    // from day one; also writes layout_data + total_seats back.
    if (plan) await replaceSeatPlan(id, plan);
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** Simple grid generator: floors × rows × cols of plain seats, aisle down the middle. */
function gridToPlan(grid: { rows?: number; cols?: number; floors?: number }): SeatPlan {
  const rows = Math.max(1, grid.rows ?? 4);
  const cols = Math.max(2, grid.cols ?? 4);
  const floors = Math.max(1, Math.min(2, grid.floors ?? 1));
  const decks: SeatPlan["decks"] = [];
  for (let f = 0; f < floors; f++) {
    const cells: SeatPlan["decks"][number]["cells"] = [];
    let n = f === 0 ? 0 : 100;
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= cols; c++) {
        if (cols >= 4 && c === Math.ceil(cols / 2)) continue; // centre aisle
        n += 1;
        cells.push({
          row: r,
          col: c,
          kind: "seat",
          label: String(n).padStart(2, "0"),
          seatClass: null,
          seatId: null,
        });
      }
    }
    decks.push({
      name: floors > 1 ? (f === 0 ? "Tầng dưới" : "Tầng trên") : null,
      rows,
      cols,
      cells,
    });
  }
  return { decks };
}
