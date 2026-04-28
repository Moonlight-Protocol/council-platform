/**
 * Integration tests for CouncilChannelRepository.
 *
 * Run with: deno test --allow-all --config tests/deno.json tests/integration/repository/council-channel.repository.test.ts
 */
import { assertEquals, assertExists } from "@std/assert";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import {
  drizzleClient,
  ensureInitialized,
  resetDb,
  seedChannel,
} from "../../test_helpers.ts";

const repo = new CouncilChannelRepository(drizzleClient);

Deno.test("create - inserts a channel", async () => {
  await ensureInitialized();
  await resetDb();

  const result = await repo.create({
    id: crypto.randomUUID(),
    councilId: "default",
    channelContractId:
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4",
    assetCode: "XLM",
    label: "Test Channel",
  });

  assertEquals(result.assetCode, "XLM");
  assertEquals(result.label, "Test Channel");
});

Deno.test("findByContractId - returns the correct channel", async () => {
  await ensureInitialized();
  await resetDb();

  const channel = await seedChannel({
    channelContractId:
      "CTEST1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4",
  });

  const found = await repo.findByContractId(
    "default",
    "CTEST1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4",
  );
  assertExists(found);
  assertEquals(found.id, channel.id);
});

Deno.test("findByContractId - excludes soft-deleted channels", async () => {
  await ensureInitialized();
  await resetDb();

  const channel = await seedChannel();
  await repo.delete(channel.id);

  const found = await repo.findByContractId(
    "default",
    channel.channelContractId,
  );
  assertEquals(found, undefined);
});

Deno.test("listAll - returns only non-deleted channels", async () => {
  await ensureInitialized();
  await resetDb();

  const ch1 = await seedChannel({
    channelContractId:
      "CLIST1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4",
  });
  const ch2 = await seedChannel({
    channelContractId:
      "CLIST2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4",
  });
  await repo.delete(ch2.id);

  const all = await repo.listAll("default");
  assertEquals(all.length, 1);
  assertEquals(all[0].id, ch1.id);
});

Deno.test("listDisabled - returns only soft-deleted channels", async () => {
  await ensureInitialized();
  await resetDb();

  const ch1 = await seedChannel({
    channelContractId:
      "CDIS1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4",
  });
  await seedChannel({
    channelContractId:
      "CDIS2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4",
  });
  await repo.delete(ch1.id);

  const disabled = await repo.listDisabled("default");
  assertEquals(disabled.length, 1);
  assertEquals(disabled[0].id, ch1.id);
});

Deno.test("findByIdIncludeDeleted - returns soft-deleted records", async () => {
  await ensureInitialized();
  await resetDb();

  const channel = await seedChannel();
  await repo.delete(channel.id);

  const found = await repo.findByIdIncludeDeleted(channel.id);
  assertExists(found);
  assertEquals(found.id, channel.id);
  assertExists(found.deletedAt);
});

Deno.test("restore - clears deletedAt", async () => {
  await ensureInitialized();
  await resetDb();

  const channel = await seedChannel();
  await repo.delete(channel.id);

  // Verify deleted
  const deleted = await repo.findByContractId(
    "default",
    channel.channelContractId,
  );
  assertEquals(deleted, undefined);

  // Restore
  await repo.restore(channel.id);

  // Verify restored
  const restored = await repo.findByContractId(
    "default",
    channel.channelContractId,
  );
  assertExists(restored);
  assertEquals(restored.deletedAt, null);
});
