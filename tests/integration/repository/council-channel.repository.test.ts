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

Deno.test("listDisabled - returns channels with disabled status", async () => {
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
  // Disable via the authoritative status write (what the watcher does).
  await repo.setStatusByContractId(
    "default",
    ch1.channelContractId,
    "disabled",
  );

  const disabled = await repo.listDisabled("default");
  assertEquals(disabled.length, 1);
  assertEquals(disabled[0].id, ch1.id);
  assertEquals(disabled[0].status, "disabled");
});

Deno.test("listAll - includes disabled (not soft-deleted) channels with status", async () => {
  await ensureInitialized();
  await resetDb();

  const ch1 = await seedChannel({
    channelContractId:
      "CLAL1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4",
  });
  await repo.setStatusByContractId(
    "default",
    ch1.channelContractId,
    "disabled",
  );

  // Disabled channels stay visible to providers via listAll (not hidden).
  const all = await repo.listAll("default");
  assertEquals(all.length, 1);
  assertEquals(all[0].status, "disabled");
});

Deno.test("setPendingAction - sets optimistic marker without changing status", async () => {
  await ensureInitialized();
  await resetDb();

  const channel = await seedChannel();
  assertEquals(channel.status, "enabled");

  const updated = await repo.setPendingAction(channel.id, "disable");
  // status is unchanged — only the watcher may write it.
  assertEquals(updated.status, "enabled");
  assertEquals(updated.pendingAction, "disable");
});

Deno.test("setStatusByContractId - flips status and clears pendingAction", async () => {
  await ensureInitialized();
  await resetDb();

  const channel = await seedChannel();
  await repo.setPendingAction(channel.id, "disable");

  const updated = await repo.setStatusByContractId(
    "default",
    channel.channelContractId,
    "disabled",
  );
  assertExists(updated);
  assertEquals(updated.status, "disabled");
  assertEquals(updated.pendingAction, null);

  // Re-enable path: status flips back, marker cleared again.
  await repo.setPendingAction(channel.id, "enable");
  const reEnabled = await repo.setStatusByContractId(
    "default",
    channel.channelContractId,
    "enabled",
  );
  assertExists(reEnabled);
  assertEquals(reEnabled.status, "enabled");
  assertEquals(reEnabled.pendingAction, null);
});

Deno.test("setStatusByContractId - is scoped by council", async () => {
  await ensureInitialized();
  await resetDb();

  const channel = await seedChannel();
  const result = await repo.setStatusByContractId(
    "other-council",
    channel.channelContractId,
    "disabled",
  );
  assertEquals(result, undefined);
});

Deno.test("findByIdIncludeDeleted - returns records regardless of status", async () => {
  await ensureInitialized();
  await resetDb();

  const channel = await seedChannel();
  await repo.setStatusByContractId(
    "default",
    channel.channelContractId,
    "disabled",
  );

  const found = await repo.findByIdIncludeDeleted(channel.id);
  assertExists(found);
  assertEquals(found.id, channel.id);
  assertEquals(found.status, "disabled");
});
