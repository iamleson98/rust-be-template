import { limitWrite } from "@/lib/rate-limit";
import { handleRouteError, readJson, requireUser } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { intParam } from "@/lib/services/http-errors";
import { createPost, listPosts, validatePost, type PostBody } from "@/lib/services/posts";

/** `GET /api/posts` — announcements, newest first (public). */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    return Response.json(
      await listPosts(
        intParam("limit", q.get("limit"), 20),
        intParam("offset", q.get("offset"), 0),
      ),
    );
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `POST /api/posts` — publish a post (`posts:write`). */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    await limitWrite("post", user.id);
    const body = await readJson<PostBody>(req);
    validatePost(body, false);
    await requirePermission(user, "posts:write");
    return Response.json(await createPost(user.id, body as { title: string; body: string }));
  } catch (e) {
    return handleRouteError(e);
  }
}
