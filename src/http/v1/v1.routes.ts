import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { buildAdminRouter } from "@/http/v1/admin/routes.ts";
import { buildCouncilRouter } from "@/http/v1/council/routes.ts";
import { buildPublicRouter } from "@/http/v1/public/routes.ts";
import { buildRpcRouter } from "@/http/v1/rpc/routes.ts";
import healthRouter from "@/http/v1/health/routes.ts";
import { buildWaitlistRouter } from "@/http/v1/waitlist/routes.ts";

export function buildApiRouter(deps: { log: Logger }): Router {
  const apiRouter = new Router();

  const adminRouter = buildAdminRouter(deps);
  const councilRouter = buildCouncilRouter(deps);
  const publicRouter = buildPublicRouter(deps);
  const rpcRouter = buildRpcRouter(deps);
  const waitlistRouter = buildWaitlistRouter(deps);

  apiRouter.use(
    "/api/v1",
    healthRouter.routes(),
    healthRouter.allowedMethods(),
  );
  apiRouter.use("/api/v1", adminRouter.routes(), adminRouter.allowedMethods());
  apiRouter.use(
    "/api/v1",
    councilRouter.routes(),
    councilRouter.allowedMethods(),
  );
  apiRouter.use(
    "/api/v1",
    publicRouter.routes(),
    publicRouter.allowedMethods(),
  );
  apiRouter.use("/api/v1", rpcRouter.routes(), rpcRouter.allowedMethods());
  apiRouter.use(
    "/api/v1",
    waitlistRouter.routes(),
    waitlistRouter.allowedMethods(),
  );

  return apiRouter;
}
