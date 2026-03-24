import { Router } from "@oak/oak";
import { postChallengeHandler } from "@/http/v1/admin/auth/challenge.ts";
import { postVerifyHandler } from "@/http/v1/admin/auth/verify.ts";
import { lowRateLimitMiddleware } from "@/http/middleware/rate-limit/index.ts";

const adminRouter = new Router();

// Auth (public, strict rate limit)
adminRouter.post("/admin/auth/challenge", lowRateLimitMiddleware, postChallengeHandler);
adminRouter.post("/admin/auth/verify", lowRateLimitMiddleware, postVerifyHandler);

export default adminRouter;
