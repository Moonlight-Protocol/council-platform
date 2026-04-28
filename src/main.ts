import { Application } from "@oak/oak";

import apiV1 from "@/http/v1/v1.routes.ts";
import { appendRequestIdMiddleware } from "@/http/middleware/append-request-id.ts";
import { appendResponseHeadersMiddleware } from "@/http/middleware/append-response-headers.ts";
import { traceContextMiddleware } from "@/http/middleware/trace-context.ts";
import { corsMiddleware } from "@/http/middleware/cors.ts";
import { PORT } from "@/config/env.ts";
import { LOG } from "@/config/logger.ts";
import {
  startEventWatcher,
  stopEventWatcher,
} from "@/core/service/event-watcher/index.ts";

async function bootstrap() {
  try {
    // Start watching for Channel Auth contract events
    await startEventWatcher();

    const app = new Application();

    app.use(corsMiddleware);
    app.use(traceContextMiddleware);
    app.use(appendRequestIdMiddleware);
    app.use(appendResponseHeadersMiddleware);
    app.use(apiV1.routes());
    app.use(apiV1.allowedMethods());

    LOG.info(`Council Platform running on http://localhost:${PORT}`);

    const shutdown = () => {
      LOG.info("Shutting down server...");
      stopEventWatcher();
      Deno.exit(0);
    };

    Deno.addSignalListener("SIGINT", shutdown);
    Deno.addSignalListener("SIGTERM", shutdown);

    await app.listen({ port: Number(PORT) });
  } catch (error) {
    LOG.error("Failed to start server", {
      error: error instanceof Error ? error.message : String(error),
    });
    stopEventWatcher();
    Deno.exit(1);
  }
}

bootstrap();
