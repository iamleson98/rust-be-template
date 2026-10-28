import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff } from "@/lib/api";

/**
 * `GET /api/presence/staff` — staff only: who of the staff is online right now
 * (Rust `StaffPresenceResponse`). Presence state is maintained by the
 * chat hub in the original deployment; without the WS hub we derive it
 * from `staff_presence_state` (last_seen freshness) so the widget shows
 * an honest snapshot.
 */
const ONLINE_WINDOW_SEC = 90;

export async function GET(req: Request) {
  try {
    // Staff only (Rust parity): the roster and its load are internal data.
    await requireStaff(req);
    const rows = await rawAll<{
      user_id: string;
      name: string;
      role: string;
      brand_id: string | null;
      online: number;
      last_seen_at: string | null;
      last_online_at: string | null;
    }>(sql`
      SELECT sps.user_id, u.full_name AS name, u.role, sps.brand_id,
             sps.online, sps.last_seen_at, sps.last_online_at
      FROM staff_presence_state sps
      JOIN user u ON u.id = sps.user_id
      WHERE u.status = 'active'
    `);
    const now = Date.now();
    const fresh = (t: string | null) =>
      !!t &&
      (now - new Date(t.replace(" ", "T") + (t.includes("Z") ? "" : "Z")).getTime()) / 1000 <
        ONLINE_WINDOW_SEC;

    const staff = rows.map((r) => {
      const online = fresh(r.last_seen_at);
      return {
        userId: r.user_id,
        name: r.name,
        role: r.role,
        brandId: r.brand_id,
        online,
        available: online,
        busy: false,
        inCall: false,
        activeChats: 0,
        lastSeenAt: r.last_seen_at,
      };
    });
    const onlineCount = staff.filter((s) => s.online).length;
    const offline = rows
      .filter((r) => !fresh(r.last_seen_at))
      .map((r) => ({
        userId: r.user_id,
        name: r.name,
        role: r.role,
        brandId: r.brand_id,
        lastSeenAt: r.last_seen_at ?? new Date(0).toISOString(),
        lastOnlineAt: r.last_online_at,
      }));
    return Response.json({
      staff,
      offline,
      onlineCount,
      availableCount: onlineCount,
      botActive: onlineCount === 0,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
