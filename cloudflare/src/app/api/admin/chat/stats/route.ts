import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff } from "@/lib/api";

/** `GET /api/admin/chat/stats` — support-channel counters (Rust `ChatStatsResponse`). */
export async function GET(req: Request) {
  try {
    await requireStaff(req);
    const rows = await rawAll<{
      total_channels: number;
      open_count: number;
      assigned_count: number;
      closed_count: number;
      avg_response: number | null;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM chat_channel) AS total_channels,
        (SELECT COUNT(*) FROM chat_channel WHERE status = 'open') AS open_count,
        (SELECT COUNT(*) FROM chat_channel WHERE status = 'assigned') AS assigned_count,
        (SELECT COUNT(*) FROM chat_channel WHERE status = 'closed') AS closed_count,
        (SELECT AVG(julianday(m2.created_at) - julianday(m1.created_at)) * 86400
           FROM chat_message m1
           JOIN chat_message m2 ON m2.channel_id = m1.channel_id AND m2.sender_role = 'staff'
           WHERE m1.sender_role = 'customer'
             AND m2.created_at = (SELECT MIN(m3.created_at) FROM chat_message m3
                                   WHERE m3.channel_id = m1.channel_id AND m3.sender_role = 'staff'
                                     AND m3.created_at >= m1.created_at)
        ) AS avg_response
    `);
    const r = rows[0];
    return Response.json({
      totalChannels: Number(r?.total_channels ?? 0),
      openCount: Number(r?.open_count ?? 0),
      assignedCount: Number(r?.assigned_count ?? 0),
      closedCount: Number(r?.closed_count ?? 0),
      avgResponseTimeSecs: Math.round(Number(r?.avg_response ?? 0)) || 0,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
