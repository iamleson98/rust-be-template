import { handleRouteError, requireUser } from "@/lib/api";
import { isStaff } from "@/lib/auth/rbac";
import { hubStaff } from "@/lib/services/chat-hub-bridge";
import { forbidden } from "@/lib/services/http-errors";

/**
 * `GET /api/presence/staff` — staff only: who is online / busy / available
 * right now (live, from the chat hub) and who was recently active.
 * Customers hear only whether the bot is on duty, over the socket.
 */
export async function GET(req: Request) {
  try {
    if (!isStaff(await requireUser(req))) throw forbidden("staff only");
    return Response.json(await hubStaff());
  } catch (e) {
    return handleRouteError(e);
  }
}
