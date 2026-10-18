import { cookies } from "next/headers";
import { currentUser, type SessionUser } from "./session";

/** Server-component-friendly session resolution (reads the request cookies). */
export async function currentUserFromCookies(): Promise<SessionUser | null> {
  try {
    const store = await cookies();
    const cookieHeader = store.toString();
    return await currentUser(
      new Request("http://local/_session", { headers: { cookie: cookieHeader } }),
    );
  } catch {
    return null;
  }
}
