import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff } from "@/lib/api";

/**
 * `GET /api/admin/chat/stats` — support-channel counters (Rust
 * `ChatStatsResponse`: `count_channels_by_status` + the
 * `avg_first_response_time_secs` query).
 *
 * The average is the Rust query verbatim: per channel, the first
 * `sender_type='user'` message and the first `sender_type='employee'`
 * reply after it; the mean of those deltas in seconds. (An earlier
 * draft of this port used `sender_role`/'customer'/'staff' — column and
 * values that do not exist on `chat_message` — which made the whole
 * endpoint 500.)
 */
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
        (SELECT AVG((julianday(e.first_emp) - julianday(u.first_user)) * 86400.0)
           FROM (
             SELECT channel_id, MIN(created_at) AS first_user
             FROM chat_message WHERE sender_type = 'user' GROUP BY channel_id
           ) u
           JOIN (
             SELECT channel_id, MIN(created_at) AS first_emp
             FROM chat_message WHERE sender_type = 'employee' GROUP BY channel_id
           ) e ON u.channel_id = e.channel_id
           WHERE e.first_emp > u.first_user
        ) AS avg_response
    `);
    const r = rows[0];
    // One aggregate row always comes back; treat a missing row as zeros
    // explicitly rather than papering over it with fallback operators.
    if (r === undefined) {
      return Response.json({
        totalChannels: 0,
        openCount: 0,
        assignedCount: 0,
        closedCount: 0,
        avgResponseTimeSecs: 0,
      });
    }
    return Response.json({
      totalChannels: Number(r.total_channels),
      openCount: Number(r.open_count),
      assignedCount: Number(r.assigned_count),
      closedCount: Number(r.closed_count),
      // AVG() is NULL when no channel has a staff reply yet — zero then.
      avgResponseTimeSecs: Math.round(r.avg_response === null ? 0 : Number(r.avg_response)) || 0,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
