import { assertEquals, assertStringIncludes } from "@std/assert";
import { Level, newLogger, type Writer } from "./index.ts";
import { PlatformError } from "@/error/index.ts";

function capture(): { writer: Writer; lines: string[] } {
  const lines: string[] = [];
  return { writer: { write: (l) => lines.push(l) }, lines };
}

Deno.test("logger.error flattens the full cause chain", () => {
  const { writer, lines } = capture();
  const log = newLogger(Level.Info, { writer });

  const root = new Error("rpc timeout");
  const mid = new Error("submit failed", { cause: root });
  const top = new PlatformError({
    source: "@service/channel",
    code: "CHANNEL_001",
    message: "Failed to query channel on-chain state",
    baseError: mid,
  });

  log.error(top, "request failed");

  assertEquals(lines.length, 1);
  assertStringIncludes(
    lines[0],
    "Failed to query channel on-chain state <- submit failed <- rpc timeout",
  );
});

Deno.test("logger.error renders correlation ids", () => {
  const { writer, lines } = capture();
  const log = newLogger(Level.Info, { writer });

  log.error(new Error("boom"), "request failed", {
    requestId: "req-123",
    traceId: "trace-abc",
  });

  assertStringIncludes(lines[0], "requestId=req-123");
  assertStringIncludes(lines[0], "traceId=trace-abc");
});
