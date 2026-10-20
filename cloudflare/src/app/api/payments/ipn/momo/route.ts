import { ApiError } from "@/lib/auth/rbac";
import { handleMomoIpn } from "@/lib/services/payment";

/**
 * `POST /api/payments/ipn/momo` — MoMo notification. HTTP 200 with
 * `code` 0 processed, 1 order not found, 2 anything that could not be
 * verified; a body that is not the expected JSON is rejected with 4xx.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
    if (body === null || typeof body !== "object" || Array.isArray(body))
      throw new Error("not an object");
  } catch {
    return Response.json(
      { error: { code: "bad-json", message: "Request body must be valid JSON" } },
      { status: 400 },
    );
  }
  try {
    await handleMomoIpn(body);
    return Response.json({ code: 0, message: "Success" });
  } catch (e) {
    if (e instanceof ApiError && e.status === 422)
      return Response.json({ error: { code: e.code, message: e.message } }, { status: 422 });
    if (e instanceof ApiError && e.status === 404) {
      console.warn("[ipn] MoMo: payment not found", e.message);
      return Response.json({ code: 1, message: "Order Not Found" });
    }
    console.warn("[ipn] MoMo verification failed", e);
    return Response.json({ code: 2, message: "Invalid Signature" });
  }
}
