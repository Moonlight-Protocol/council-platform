import type { Context } from "@oak/oak";
import { Status } from "@oak/oak";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";

/**
 * Middleware that requires the JWT to have type "admin".
 * Must be applied AFTER jwtMiddleware.
 */
export async function requireAdminMiddleware(
  ctx: Context,
  next: () => Promise<unknown>,
) {
  const session = ctx.state.session as JwtSessionData | undefined;
  if (!session || session.type !== "admin") {
    ctx.response.status = Status.Forbidden;
    ctx.response.body = { message: "Admin access required" };
    return;
  }
  await next();
}
