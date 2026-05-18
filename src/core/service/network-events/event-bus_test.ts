import { assertEquals } from "@std/assert";
import { networkEventBus } from "./event-bus.ts";
import type { NetworkEventFrame } from "./types.ts";

function makeFrame(id: string): NetworkEventFrame {
  return {
    id,
    kind: "provider_added",
    councilId: "COUNCIL_X",
    ledger: 1,
    occurredAt: new Date(0).toISOString(),
    payload: {},
  };
}

Deno.test("event-bus — subscribe receives published events", () => {
  const received: string[] = [];
  const unsubscribe = networkEventBus.subscribe((e) => received.push(e.id));

  networkEventBus.publish(makeFrame("a"));
  networkEventBus.publish(makeFrame("b"));

  assertEquals(received, ["a", "b"]);
  unsubscribe();
});

Deno.test("event-bus — unsubscribe stops delivery", () => {
  const received: string[] = [];
  const unsubscribe = networkEventBus.subscribe((e) => received.push(e.id));
  unsubscribe();

  networkEventBus.publish(makeFrame("c"));
  assertEquals(received, []);
});

Deno.test("event-bus — multiple subscribers each receive every event", () => {
  const a: string[] = [];
  const b: string[] = [];
  const unsubA = networkEventBus.subscribe((e) => a.push(e.id));
  const unsubB = networkEventBus.subscribe((e) => b.push(e.id));

  networkEventBus.publish(makeFrame("x"));

  assertEquals(a, ["x"]);
  assertEquals(b, ["x"]);
  unsubA();
  unsubB();
});

Deno.test("event-bus — a throwing listener does not break the publish loop", () => {
  const received: string[] = [];
  const unsubA = networkEventBus.subscribe(() => {
    throw new Error("listener boom");
  });
  const unsubB = networkEventBus.subscribe((e) => received.push(e.id));

  networkEventBus.publish(makeFrame("y"));

  assertEquals(received, ["y"]);
  unsubA();
  unsubB();
});

Deno.test("event-bus — listenerCount reflects subscriptions", () => {
  assertEquals(networkEventBus.listenerCount(), 0);
  const u1 = networkEventBus.subscribe(() => {});
  const u2 = networkEventBus.subscribe(() => {});
  assertEquals(networkEventBus.listenerCount(), 2);
  u1();
  assertEquals(networkEventBus.listenerCount(), 1);
  u2();
  assertEquals(networkEventBus.listenerCount(), 0);
});
