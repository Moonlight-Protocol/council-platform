import type { Context, Next } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { PIPE_APIError } from "@/http/pipelines/error-pipeline.ts";
import { currentTraceId } from "@/core/tracing.ts";

/**
 * Outermost error boundary for the HTTP layer.
 *
 * Any error thrown by a downstream middleware, route, pipeline, or service
 * bubbles here. We log it with the full cause chain plus correlation ids
 * (requestId / traceId), then translate it to the structured `ErrorResponse`
 * (`{ status, code, message, details }`) at the edge via `PIPE_APIError`.
 *
 * This is the single place where an internal error becomes a client-facing
 * response, so handlers and services `throw` (raw or `PlatformError`) instead of
 * hand-writing ad-hoc `{ message }` bodies — the redacted `api` projection is
 * all that ever reaches the client; the chain/stack stay in logs and OTel.
 */
export function errorMiddleware(
  deps: { log: Logger },
): (ctx: Context, next: Next) => Promise<void> {
  const log = deps.log.scope("errorMiddleware");

  return async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      log.error(error, "request failed", {
        requestId: ctx.state.requestId,
        traceId: currentTraceId(),
        method: ctx.request.method,
        path: new URL(ctx.request.url).pathname,
      });

      await PIPE_APIError(ctx, deps).run(error as Error);
    }
  };
}
