/**
 * Integration test for recordAndPublishNetworkEvent.
 *
 * Verifies the persist-then-publish contract end-to-end via PGlite + the
 * in-process bus.
 */
import { assertEquals, assertNotEquals } from "@std/assert";
import { NetworkEventRepository } from "@/persistence/drizzle/repository/network-event.repository.ts";
import {
  recordAndPublishNetworkEvent,
  setRepoForTests,
} from "@/core/service/network-events/network-events.service.ts";
import { networkEventBus } from "@/core/service/network-events/event-bus.ts";
import type { NetworkEventFrame } from "@/core/service/network-events/types.ts";
import {
  drizzleClient,
  ensureInitialized,
  resetDb,
} from "../../test_helpers.ts";

const repo = new NetworkEventRepository(drizzleClient);
setRepoForTests(repo);

Deno.test("recordAndPublish — persists row and broadcasts a frame", async () => {
  await ensureInitialized();
  await resetDb();

  const received: NetworkEventFrame[] = [];
  const unsubscribe = networkEventBus.subscribe((f) => received.push(f));

  try {
    const id = crypto.randomUUID();
    const occurredAt = new Date();
    await recordAndPublishNetworkEvent({
      id,
      kind: "provider_added",
      councilId: "CCOUNCIL_TEST",
      ledger: 42,
      occurredAt,
      payload: { providerPublicKey: "GPP_TEST", councilName: "Council A" },
    });

    const rows = await repo.listRecent({ limit: 10 });
    assertEquals(rows.length, 1);
    assertEquals(rows[0].id, id);
    assertEquals(rows[0].kind, "provider_added");
    assertEquals(rows[0].councilId, "CCOUNCIL_TEST");

    assertEquals(received.length, 1);
    assertEquals(received[0].id, id);
    assertEquals(received[0].kind, "provider_added");
    assertEquals(received[0].councilId, "CCOUNCIL_TEST");
    assertEquals(received[0].ledger, 42);
    assertEquals(received[0].payload.providerPublicKey, "GPP_TEST");
    assertEquals(received[0].payload.councilName, "Council A");
    assertNotEquals(received[0].occurredAt, ""); // ISO string set
  } finally {
    unsubscribe();
  }
});

Deno.test("recordAndPublish — publish failure does not unwind the DB write", async () => {
  await ensureInitialized();
  await resetDb();

  const unsubscribe = networkEventBus.subscribe(() => {
    throw new Error("listener boom");
  });

  try {
    await recordAndPublishNetworkEvent({
      id: crypto.randomUUID(),
      kind: "provider_added",
      councilId: "CCOUNCIL_TEST",
      ledger: 1,
      occurredAt: new Date(),
      payload: {},
    });

    const rows = await repo.listRecent({ limit: 10 });
    assertEquals(rows.length, 1);
  } finally {
    unsubscribe();
  }
});
