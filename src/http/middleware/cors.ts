import type { Context, Next } from "@oak/oak";
import { MODE } from "@/config/env.ts";

const PRODUCTION_ORIGINS = [
  "https://moonlight-council-console.fly.storage.tigris.dev",
  "https://moonlight-network-dashboard.fly.storage.tigris.dev",
];

const DEV_ORIGINS = [
  "http://localhost:3000", "http://localhost:3010", "http://localhost:3020",
  "http://localhost:3030", "http://localhost:3050", "http://localhost:3060",
];

function isAllowedOrigin(origin: string): boolean {
  if (PRODUCTION_ORIGINS.includes(origin)) return true;
  if (MODE === "development" && DEV_ORIGINS.includes(origin)) return true;
  return false;
}

function setCorsHeaders(ctx: Context, origin: string) {
  ctx.response.headers.set("Access-Control-Allow-Origin", origin);
  ctx.response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  ctx.response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  ctx.response.headers.set("Access-Control-Max-Age", "86400");
}

export async function corsMiddleware(ctx: Context, next: Next) {
  const origin = ctx.request.headers.get("Origin");
  const allowed = origin && isAllowedOrigin(origin);

  if (ctx.request.method === "OPTIONS" && allowed) {
    setCorsHeaders(ctx, origin);
    ctx.response.status = 204;
    return;
  }

  try {
    await next();
  } finally {
    if (allowed) {
      setCorsHeaders(ctx, origin!);
    }
  }
}
