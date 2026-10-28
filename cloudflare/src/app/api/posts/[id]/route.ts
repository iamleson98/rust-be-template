import { handleRouteError, readJson, requireUser } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { uuidParam } from "@/lib/services/http-errors";
import { deletePost, getPost, updatePost, validatePost, type PostBody } from "@/lib/services/posts";

type Params = { params: Promise<{ id: string }> };

const postId = async (ctx: Params) => uuidParam("id", (await ctx.params).id) as string;

/** `GET /api/posts/{id}` — one post (public). */
export async function GET(_req: Request, ctx: Params) {
  try {
    return Response.json(await getPost(await postId(ctx)));
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `PATCH /api/posts/{id}` — edit the fields sent (`posts:write`). */
export async function PATCH(req: Request, ctx: Params) {
  try {
    const user = await requireUser(req);
    const id = await postId(ctx);
    const body = await readJson<PostBody>(req);
    validatePost(body, true);
    await requirePermission(user, "posts:write");
    return Response.json(await updatePost(id, body));
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `DELETE /api/posts/{id}` — remove a post (`posts:delete`); deleting a missing one is not an error. */
export async function DELETE(req: Request, ctx: Params) {
  try {
    const user = await requireUser(req);
    await requirePermission(user, "posts:delete");
    await deletePost(await postId(ctx));
    return new Response(null, { status: 200 });
  } catch (e) {
    return handleRouteError(e);
  }
}
