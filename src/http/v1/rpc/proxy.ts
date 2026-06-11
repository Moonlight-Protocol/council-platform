import { type Context, Status } from "@oak/oak";
import { NETWORK_CONFIG } from "@/config/env.ts";
import type { Logger } from "@/utils/logger/index.ts";

/**
 * Transparent Soroban JSON-RPC passthrough proxy.
 *
 * The council-console frontend points its `@stellar/stellar-sdk` `rpc.Server`
 * at `POST /api/v1/rpc` instead of the raw `STELLAR_RPC_URL`. This handler
 * forwards the JSON-RPC 2.0 body verbatim to the server-side RPC (token
 * injected via the network config) and relays the upstream response
 * unchanged, so the SDK `Server` behaves identically. The RPC-Pro token
 * never reaches the browser bundle.
 *
 * Gated by the operator/dashboard `jwtMiddleware` (mounted in routes.ts) —
 * never an open relay.
 *
 * Allowlist: only the JSON-RPC methods the frontends actually call (Phase 0
 * audit). Unknown methods are rejected with a JSON-RPC error, not a 500.
 */
const ALLOWED_METHODS = new Set<string>([
  "getAccount",
  "getLedgerEntries",
  "simulateTransaction",
  "sendTransaction",
  "getTransaction",
  "getLatestLedger",
]);

type JsonRpcRequest = { jsonrpc?: unknown; id?: unknown; method?: unknown };

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function firstId(payload: unknown): unknown {
  if (Array.isArray(payload)) return null;
  const id = (payload as JsonRpcRequest | null)?.id;
  return id ?? null;
}

export function handleRpcProxy(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("rpcProxy");

  return async (ctx) => {
    let payload: unknown;
    try {
      payload = await ctx.request.body.json();
    } catch {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = jsonRpcError(null, -32700, "Parse error");
      return;
    }

    // Soroban RPC sends single requests; tolerate a JSON-RPC batch (array)
    // defensively — every method in it must be allowlisted.
    const entries: JsonRpcRequest[] = Array.isArray(payload)
      ? payload as JsonRpcRequest[]
      : [payload as JsonRpcRequest];

    for (const entry of entries) {
      const method = typeof entry?.method === "string" ? entry.method : "";
      if (!ALLOWED_METHODS.has(method)) {
        log.debug("rejected method", method || "(none)");
        // Mirror Soroban RPC: HTTP 200 with a JSON-RPC error object.
        ctx.response.status = Status.OK;
        ctx.response.body = jsonRpcError(
          entry?.id ?? null,
          -32601,
          `Method not allowed: ${method || "(none)"}`,
        );
        return;
      }
    }

    let upstream: Response;
    try {
      upstream = await fetch(NETWORK_CONFIG.rpcUrl as string, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      log.error(error, "upstream RPC fetch failed");
      ctx.response.status = Status.BadGateway;
      ctx.response.body = jsonRpcError(
        firstId(payload),
        -32603,
        "Upstream RPC unreachable",
      );
      return;
    }

    const text = await upstream.text();
    // Method + status only — never request/response bodies (may carry tx data).
    log.debug("method", entries.map((e) => e?.method ?? "").join(","));
    log.debug("status", upstream.status);

    ctx.response.status = upstream.status;
    try {
      ctx.response.body = JSON.parse(text);
    } catch {
      ctx.response.body = text;
    }
  };
}
