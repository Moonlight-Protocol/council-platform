import { Router } from "@oak/oak";
import { postChallengeHandler } from "@/http/v1/admin/auth/challenge.ts";
import { postVerifyHandler } from "@/http/v1/admin/auth/verify.ts";

const adminRouter = new Router();

// Auth (public, auth)

export default adminRouter;
