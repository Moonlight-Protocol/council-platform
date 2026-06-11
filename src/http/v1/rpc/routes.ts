import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";
import { handleRpcProxy } from "@/http/v1/rpc/proxy.ts";

/**
 * Soroban RPC passthrough proxy, gated by the operator/dashboard JWT.
 * `POST /api/v1/rpc` — see proxy.ts.
 */
export function buildRpcRouter(deps: { log: Logger }): Router {
  const rpcRouter = new Router();
  rpcRouter.post("/rpc", jwtMiddleware(deps), handleRpcProxy(deps));
  return rpcRouter;
}
