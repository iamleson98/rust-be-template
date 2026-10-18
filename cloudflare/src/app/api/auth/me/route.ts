import { handleRouteError, requireUser } from "@/lib/api";
import { accessTtlSecs } from "@/lib/auth/jwt";

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    return Response.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatarUrl: user.avatarUrl,
        brandId: user.brandId,
        locale: user.locale,
      },
      expiresAt: Math.floor(Date.now() / 1000) + (await accessTtlSecs()),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
