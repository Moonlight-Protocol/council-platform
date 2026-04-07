import { Router } from "@oak/oak";
import adminRouter from "@/http/v1/admin/routes.ts";
import councilRouter from "@/http/v1/council/routes.ts";
import publicRouter from "@/http/v1/public/routes.ts";
import healthRouter from "@/http/v1/health/routes.ts";

const apiRouter = new Router();

apiRouter.use("/api/v1", healthRouter.routes(), healthRouter.allowedMethods());
apiRouter.use("/api/v1", adminRouter.routes(), adminRouter.allowedMethods());
apiRouter.use("/api/v1", councilRouter.routes(), councilRouter.allowedMethods());
apiRouter.use("/api/v1", publicRouter.routes(), publicRouter.allowedMethods());

export default apiRouter;
