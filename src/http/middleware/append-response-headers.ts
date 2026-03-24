import type { Context } from "@oak/oak";

export async function appendResponseHeadersMiddleware(
  ctx: Context,
  next: () => Promise<unknown>
) {
  await next();

  // Security headers (CORS is handled by cors.ts — do not set Access-Control-Allow-Origin here)
  ctx.response.headers.set("X-Content-Type-Options", "nosniff");
  ctx.response.headers.set("X-Frame-Options", "DENY");
}
