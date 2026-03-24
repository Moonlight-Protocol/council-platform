import { Router, Status } from "@oak/oak";

const healthRouter = new Router();

healthRouter.get("/health", (ctx) => {
  ctx.response.status = Status.OK;
  ctx.response.body = { status: "ok", service: "council-platform" };
});

export default healthRouter;
