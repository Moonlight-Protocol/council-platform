/**
 * Integration tests for the Postgres watcher cursor and its atomicity with the
 * channel-status write — the guarantee that replaces the old Deno.KV cursor.
 *
 * Run with: deno test --allow-all --config tests/deno.json tests/integration/repository/watcher-cursor.repository.test.ts
 */
import { assertEquals } from "@std/assert";
import { WatcherCursorRepository } from "@/persistence/drizzle/repository/watcher-cursor.repository.ts";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import { ChannelStatus } from "@/persistence/drizzle/entity/council-channel.entity.ts";
import {
  drizzleClient,
  ensureInitialized,
  resetDb,
  seedChannel,
} from "../../test_helpers.ts";

const CHAN = "CCURSORxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxFCT4";

Deno.test("watcher cursor - survives a restart: a fresh repo reads the persisted ledger", async () => {
  await ensureInitialized();
  await resetDb();

  await new WatcherCursorRepository(drizzleClient).upsert("default", 12345);

  // A brand-new repo instance, as a process restart would construct.
  const restored = await new WatcherCursorRepository(drizzleClient).get(
    "default",
  );
  assertEquals(restored, 12345);
});

Deno.test("watcher cursor - upsert advances an existing row", async () => {
  await ensureInitialized();
  await resetDb();
  const repo = new WatcherCursorRepository(drizzleClient);

  await repo.upsert("default", 100);
  await repo.upsert("default", 200);

  assertEquals(await repo.get("default"), 200);
});

Deno.test("watcher cursor - get returns null when no cursor is stored", async () => {
  await ensureInitialized();
  await resetDb();

  assertEquals(
    await new WatcherCursorRepository(drizzleClient).get("missing"),
    null,
  );
});

Deno.test("atomic commit - status write + cursor advance commit together", async () => {
  await ensureInitialized();
  await resetDb();
  await seedChannel({ channelContractId: CHAN }); // seeded enabled

  await drizzleClient.transaction(async (tx) => {
    await new CouncilChannelRepository(tx).setStatusByContractId(
      "default",
      CHAN,
      ChannelStatus.DISABLED,
    );
    await new WatcherCursorRepository(tx).upsert("default", 500);
  });

  const ch = await new CouncilChannelRepository(drizzleClient).findByContractId(
    "default",
    CHAN,
  );
  assertEquals(ch?.status, ChannelStatus.DISABLED);
  assertEquals(
    await new WatcherCursorRepository(drizzleClient).get("default"),
    500,
  );
});

Deno.test("atomic commit - a failure rolls BOTH back (status unchanged, cursor not advanced)", async () => {
  await ensureInitialized();
  await resetDb();
  await seedChannel({ channelContractId: CHAN }); // seeded enabled
  await new WatcherCursorRepository(drizzleClient).upsert("default", 100);

  let threw = false;
  try {
    await drizzleClient.transaction(async (tx) => {
      await new CouncilChannelRepository(tx).setStatusByContractId(
        "default",
        CHAN,
        ChannelStatus.DISABLED,
      );
      await new WatcherCursorRepository(tx).upsert("default", 200);
      // Simulate a crash after both writes but before commit.
      throw new Error("boom after writes");
    });
  } catch {
    threw = true;
  }

  assertEquals(threw, true);
  // Neither write survives: status is still enabled, cursor still 100. The DB
  // and the cursor cannot diverge.
  const ch = await new CouncilChannelRepository(drizzleClient).findByContractId(
    "default",
    CHAN,
  );
  assertEquals(ch?.status, ChannelStatus.ENABLED);
  assertEquals(
    await new WatcherCursorRepository(drizzleClient).get("default"),
    100,
  );
});
