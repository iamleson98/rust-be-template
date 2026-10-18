import { getDb } from "@/lib/db/client";
import { reviews } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { handleRouteError, requireUser } from "@/lib/api";

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const db = await getDb();
    const rows = await db
      .select()
      .from(reviews)
      .where(eq(reviews.userId, user.id))
      .orderBy(desc(reviews.createdAt))
      .limit(50);
    return Response.json({ items: rows });
  } catch (e) {
    return handleRouteError(e);
  }
}
