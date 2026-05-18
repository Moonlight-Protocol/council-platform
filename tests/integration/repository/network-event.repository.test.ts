/**
 * Integration tests for NetworkEventRepository.
 *
 * Run with: deno test --allow-all --config tests/deno.json tests/integration/repository/network-event.repository.test.ts
 */
import { assertEquals } from "@std/assert";
import { NetworkEventRepository } from "@/persistence/drizzle/repository/network-event.repository.ts";
import type { NewNetworkEvent } from "@/persistence/drizzle/entity/network-event.entity.ts";
import {
  drizzleClient,
  ensureInitialized,
  resetDb,
} from "../../test_helpers.ts";

const repo = new NetworkEventRepository(drizzleClient);

function makeEvent(overrides: Partial<NewNetworkEvent> = {}): NewNetworkEvent {
  return {
    id: crypto.randomUUID(),
    kind: "provider_added",
    councilId: "CCOUNCIL_AUTH_CONTRACT_ID_PLACEHOLDER",
    ledger: 1000,
    payload: { providerPublicKey: "GPP_PLACEHOLDER" },
    occurredAt: new Date(),
    ...overrides,
  };
}

Deno.test("insertOne — persists row and returns it", async () => {
  await ensureInitialized();
  await resetDb();

  const input = makeEvent({ kind: "council_formed" });
  const stored = await repo.insertOne(input);

  assertEquals(stored.id, input.id);
  assertEquals(stored.kind, "council_formed");
  assertEquals(stored.councilId, input.councilId);
  assertEquals(stored.ledger, 1000);
});

Deno.test("listRecent — returns rows newest-first", async () => {
  await ensureInitialized();
  await resetDb();

  const older = new Date(Date.now() - 60_000);
  const newer = new Date();
  await repo.insertOne(
    makeEvent({ occurredAt: older, kind: "provider_added" }),
  );
  await repo.insertOne(
    makeEvent({ occurredAt: newer, kind: "provider_removed" }),
  );

  const rows = await repo.listRecent({ limit: 10 });
  assertEquals(rows.length, 2);
  assertEquals(rows[0].kind, "provider_removed");
  assertEquals(rows[1].kind, "provider_added");
});

Deno.test("listRecent — `since` filters out earlier rows", async () => {
  await ensureInitialized();
  await resetDb();

  const tenMinAgo = new Date(Date.now() - 10 * 60_000);
  const oneMinAgo = new Date(Date.now() - 60_000);
  await repo.insertOne(makeEvent({ occurredAt: tenMinAgo }));
  await repo.insertOne(makeEvent({ occurredAt: oneMinAgo }));

  const cutoff = new Date(Date.now() - 5 * 60_000);
  const rows = await repo.listRecent({ since: cutoff, limit: 10 });
  assertEquals(rows.length, 1);
});

Deno.test("listRecent — limit caps the result", async () => {
  await ensureInitialized();
  await resetDb();

  for (let i = 0; i < 5; i++) {
    await repo.insertOne(makeEvent({ occurredAt: new Date(Date.now() - i) }));
  }
  const rows = await repo.listRecent({ limit: 3 });
  assertEquals(rows.length, 3);
});

Deno.test("countSince — counts rows at or after the cutoff", async () => {
  await ensureInitialized();
  await resetDb();

  const dayAgo = new Date(Date.now() - 25 * 60 * 60_000);
  const recent = new Date(Date.now() - 60_000);
  await repo.insertOne(makeEvent({ occurredAt: dayAgo }));
  await repo.insertOne(makeEvent({ occurredAt: recent }));
  await repo.insertOne(makeEvent({ occurredAt: recent }));

  const since24h = new Date(Date.now() - 24 * 60 * 60_000);
  const count = await repo.countSince(since24h);
  assertEquals(count, 2);
});

Deno.test("purgeOlderThan — deletes only rows before cutoff", async () => {
  await ensureInitialized();
  await resetDb();

  const old = new Date(Date.now() - 25 * 60 * 60_000);
  const fresh = new Date(Date.now() - 60_000);
  await repo.insertOne(makeEvent({ occurredAt: old }));
  await repo.insertOne(makeEvent({ occurredAt: old }));
  await repo.insertOne(makeEvent({ occurredAt: fresh }));

  const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
  const deleted = await repo.purgeOlderThan(cutoff);

  assertEquals(deleted, 2);
  const remaining = await repo.listRecent({ limit: 100 });
  assertEquals(remaining.length, 1);
});

Deno.test("purgeOlderThan — returns 0 when nothing to purge", async () => {
  await ensureInitialized();
  await resetDb();

  await repo.insertOne(makeEvent({ occurredAt: new Date() }));
  const deleted = await repo.purgeOlderThan(
    new Date(Date.now() - 24 * 60 * 60_000),
  );
  assertEquals(deleted, 0);
});
