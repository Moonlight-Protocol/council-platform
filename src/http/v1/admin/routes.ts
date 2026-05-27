import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { handlePostChallenge } from "@/http/v1/admin/auth/challenge.ts";
import { handlePostVerify } from "@/http/v1/admin/auth/verify.ts";

export function buildAdminRouter(deps: { log: Logger }): Router {
  const adminRouter = new Router();

  // Auth (public)
  adminRouter.post("/admin/auth/challenge", handlePostChallenge(deps));
  adminRouter.post("/admin/auth/verify", handlePostVerify(deps));

  return adminRouter;
}
