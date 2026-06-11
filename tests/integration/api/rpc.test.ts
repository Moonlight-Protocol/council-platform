/**
 * Integration tests for the Soroban RPC passthrough proxy.
 *
 * Run with: deno test --allow-all --no-check --config tests/deno.json tests/integration/api/rpc.test.ts
 *
 * The route mounts `jwtMiddleware` ahead of this handler (see
 * src/http/v1/rpc/routes.ts), so the gate itself is covered by the shared
 * middleware tests; here we exercise the handler: allowlisted forward,
 * non-allowlisted reject, and faithful upstream-error relay.
 */
import { assertEquals } from "@std/assert";
import { newNoop } from "@/utils/logger/index.ts";
import { createMockContext } from "../../test_app.ts";
import { handleRpcProxy } from "@/http/v1/rpc/proxy.ts";

type FetchArgs = { url: string; body: string };

function stubFetch(
  responder: (args: FetchArgs) => Response,
): { calls: FetchArgs[]; restore: () => void } {
  const calls: FetchArgs[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const args = { url: String(input), body: String(init?.body ?? "") };
    calls.push(args);
    return Promise.resolve(responder(args));
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

Deno.test("POST /rpc - forwards an allowlisted method and relays the response", async () => {
  const upstream = {
    jsonrpc: "2.0",
    id: 7,
    result: { sequence: 12345 },
  };
  const fetchStub = stubFetch(() =>
    new Response(JSON.stringify(upstream), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
  try {
    const { ctx, getResponse } = createMockContext({
      method: "POST",
      body: { jsonrpc: "2.0", id: 7, method: "getLatestLedger" },
    });
    await handleRpcProxy({ log: newNoop() })(ctx);

    const res = getResponse();
    assertEquals(res.status, 200);
    assertEquals(res.body, upstream);
    // Exactly one upstream call, carrying the verbatim JSON-RPC body.
    assertEquals(fetchStub.calls.length, 1);
    assertEquals(
      JSON.parse(fetchStub.calls[0].body).method,
      "getLatestLedger",
    );
  } finally {
    fetchStub.restore();
  }
});

Deno.test("POST /rpc - rejects a non-allowlisted method without hitting upstream", async () => {
  const fetchStub = stubFetch(() =>
    new Response("should not be called", {
      status: 200,
    })
  );
  try {
    const { ctx, getResponse } = createMockContext({
      method: "POST",
      body: { jsonrpc: "2.0", id: 9, method: "getEvents" },
    });
    await handleRpcProxy({ log: newNoop() })(ctx);

    const res = getResponse();
    // JSON-RPC error, not a 500; upstream never contacted.
    assertEquals(res.status, 200);
    assertEquals(res.body.error.code, -32601);
    assertEquals(res.body.id, 9);
    assertEquals(fetchStub.calls.length, 0);
  } finally {
    fetchStub.restore();
  }
});

Deno.test("POST /rpc - relays an upstream error response faithfully", async () => {
  const upstreamErr = {
    jsonrpc: "2.0",
    id: 3,
    error: { code: -32602, message: "Invalid params" },
  };
  const fetchStub = stubFetch(() =>
    new Response(JSON.stringify(upstreamErr), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
  try {
    const { ctx, getResponse } = createMockContext({
      method: "POST",
      body: { jsonrpc: "2.0", id: 3, method: "simulateTransaction" },
    });
    await handleRpcProxy({ log: newNoop() })(ctx);

    const res = getResponse();
    assertEquals(res.status, 200);
    assertEquals(res.body, upstreamErr);
    assertEquals(fetchStub.calls.length, 1);
  } finally {
    fetchStub.restore();
  }
});

Deno.test("POST /rpc - relays a non-2xx upstream status", async () => {
  const fetchStub = stubFetch(() =>
    new Response("upstream boom", { status: 502 })
  );
  try {
    const { ctx, getResponse } = createMockContext({
      method: "POST",
      body: { jsonrpc: "2.0", id: 1, method: "getAccount" },
    });
    await handleRpcProxy({ log: newNoop() })(ctx);

    const res = getResponse();
    assertEquals(res.status, 502);
    assertEquals(res.body, "upstream boom");
  } finally {
    fetchStub.restore();
  }
});
