/**
 * Integration tests for KnownAssetRepository.
 *
 * Run with: deno test --allow-all --config tests/deno.json tests/integration/repository/known-asset.repository.test.ts
 */
import { assertEquals } from "@std/assert";
import { KnownAssetRepository } from "@/persistence/drizzle/repository/known-asset.repository.ts";
import {
  drizzleClient,
  ensureInitialized,
  resetDb,
} from "../../test_helpers.ts";

const repo = new KnownAssetRepository(drizzleClient);

Deno.test("upsert - creates a new record", async () => {
  await ensureInitialized();
  await resetDb();

  const result = await repo.upsert("XLM", "");

  assertEquals(result.assetCode, "XLM");
  assertEquals(result.issuerAddress, "");
  assertEquals(result.id, "XLM:");
});

Deno.test("upsert - returns existing for duplicate", async () => {
  await ensureInitialized();
  await resetDb();

  const first = await repo.upsert("USDC", "GISSUER...");
  const second = await repo.upsert("USDC", "GISSUER...");

  assertEquals(first.id, second.id);

  const all = await repo.listAll();
  assertEquals(all.length, 1);
});

Deno.test("upsert - different issuers create separate records", async () => {
  await ensureInitialized();
  await resetDb();

  await repo.upsert("USDC", "GISSUER1");
  await repo.upsert("USDC", "GISSUER2");

  const all = await repo.listAll();
  assertEquals(all.length, 2);
});

Deno.test("listAll - returns assets ordered by assetCode", async () => {
  await ensureInitialized();
  await resetDb();

  await repo.upsert("XLM", "");
  await repo.upsert("BTC", "");
  await repo.upsert("USDC", "");

  const all = await repo.listAll();
  assertEquals(all.length, 3);
  assertEquals(all[0].assetCode, "BTC");
  assertEquals(all[1].assetCode, "USDC");
  assertEquals(all[2].assetCode, "XLM");
});
