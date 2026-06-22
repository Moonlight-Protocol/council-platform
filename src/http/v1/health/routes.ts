import { Router, Status } from "@oak/oak";
import { sql } from "drizzle-orm";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { checkDbHealth } from "@/http/v1/health/db-check.ts";

const denoJson = JSON.parse(
  await Deno.readTextFile(new URL("../../../../deno.json", import.meta.url)),
);
const version: string = denoJson.version ?? "unknown";

const healthRouter = new Router();

healthRouter.get("/health", async (ctx) => {
  // Bounded `SELECT 1` so a dead/unreachable DB surfaces as unhealthy without
  // hanging the endpoint. See checkDbHealth for why this does not flap deploys.
  const db = await checkDbHealth(() => drizzleClient.execute(sql`select 1`));
  const healthy = db === "ok";

  ctx.response.status = healthy ? Status.OK : Status.ServiceUnavailable;
  ctx.response.body = {
    status: healthy ? "ok" : "error",
    service: "council-platform",
    version,
    deps: { db },
  };
});

export default healthRouter;
