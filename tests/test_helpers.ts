/**
 * Integration test helpers for council-platform.
 *
 * Uses PGlite (in-memory PostgreSQL via WASM) — real SQL, real constraints.
 * Run with: deno test --allow-all --config tests/deno.json tests/
 */
import { Keypair, StrKey } from "stellar-sdk";
import { Buffer } from "buffer";
import {
  drizzleClient,
  resetDb,
  closeDb,
  ensureInitialized,
} from "./pglite_db.ts";
import { encryptSecret } from "@/core/crypto/encrypt-secret.ts";
import { SERVICE_AUTH_SECRET } from "@/config/env.ts";
import { councilMetadata } from "@/persistence/drizzle/entity/council-metadata.entity.ts";
import { councilChannel } from "@/persistence/drizzle/entity/council-channel.entity.ts";
import { councilJurisdiction } from "@/persistence/drizzle/entity/council-jurisdiction.entity.ts";
import { councilProvider, ProviderStatus } from "@/persistence/drizzle/entity/council-provider.entity.ts";
import { custodialUser, CustodialUserStatus } from "@/persistence/drizzle/entity/custodial-user.entity.ts";
import { councilEscrow, EscrowStatus } from "@/persistence/drizzle/entity/council-escrow.entity.ts";
import { providerJoinRequest, JoinRequestStatus } from "@/persistence/drizzle/entity/provider-join-request.entity.ts";

// ── Pre-generated Stellar keypairs ──────────────────────────────────────

export const ADMIN_KEYPAIR = Keypair.random();
export const PROVIDER_KEYPAIR = Keypair.random();

// ── Utilities ───────────────────────────────────────────────────────────

export function testAddress(): string {
  return Keypair.random().publicKey();
}

export function testContractId(): string {
  return "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4";
}

export function randomContractId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return StrKey.encodeContract(Buffer.from(bytes));
}

// ── Seed helpers ────────────────────────────────────────────────────────

export async function seedCouncilMetadata(overrides?: Partial<{
  id: string;
  name: string;
  description: string;
  contactEmail: string;
  councilPublicKey: string;
  encryptedDerivationRoot: string;
}>) {
  const data = {
    id: overrides?.id ?? "default",
    name: overrides?.name ?? "Test Council",
    description: overrides?.description ?? "A test council",
    contactEmail: overrides?.contactEmail ?? "test@example.com",
    councilPublicKey: overrides?.councilPublicKey ?? ADMIN_KEYPAIR.publicKey(),
    // Test fixture: a fixed pre-encrypted root produced from test-secret + zeroes.
    // Real councils get a random root from putMetadataHandler.
    encryptedDerivationRoot: overrides?.encryptedDerivationRoot ?? "test-fixture-root",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  };
  const [result] = await drizzleClient.insert(councilMetadata).values(data).returning();
  return result;
}

/**
 * Seeds a council with a real, decryptable derivation root.
 *
 * Unlike `seedCouncilMetadata` (which stores the fixture string `"test-fixture-root"`),
 * this helper generates a random 32-byte root, encrypts it with the test
 * SERVICE_AUTH_SECRET, and stores the ciphertext so that
 * `key-derivation.service.ts` can decrypt it at runtime.
 *
 * Use this in any test that calls into the custody, escrow, or sign
 * services / handlers where key derivation actually runs.
 *
 * Returns both the seeded council row and the raw root bytes, so tests
 * can use the raw root for assertions if needed.
 */
export async function seedCouncilWithRoot(overrides?: Partial<{
  id: string;
  name: string;
  description: string;
  contactEmail: string;
  councilPublicKey: string;
}>): Promise<{
  council: Awaited<ReturnType<typeof seedCouncilMetadata>>;
  root: Uint8Array;
}> {
  const root = crypto.getRandomValues(new Uint8Array(32));
  const encryptedDerivationRoot = await encryptSecret(root, SERVICE_AUTH_SECRET);
  const council = await seedCouncilMetadata({
    ...overrides,
    encryptedDerivationRoot,
  });
  return { council, root };
}

export async function seedChannel(overrides?: Partial<{
  councilId: string;
  channelContractId: string;
  assetCode: string;
  label: string;
}>) {
  const data = {
    id: crypto.randomUUID(),
    councilId: overrides?.councilId ?? "default",
    channelContractId: overrides?.channelContractId ?? randomContractId(),
    assetCode: overrides?.assetCode ?? "XLM",
    label: overrides?.label ?? "Test Channel",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  };
  const [result] = await drizzleClient.insert(councilChannel).values(data).returning();
  return result;
}

export async function seedJurisdiction(overrides?: Partial<{
  councilId: string;
  countryCode: string;
  label: string;
}>) {
  const data = {
    id: crypto.randomUUID(),
    councilId: overrides?.councilId ?? "default",
    countryCode: overrides?.countryCode ?? "US",
    label: overrides?.label ?? "United States",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  };
  const [result] = await drizzleClient.insert(councilJurisdiction).values(data).returning();
  return result;
}

export async function seedProvider(overrides?: Partial<{
  councilId: string;
  publicKey: string;
  status: ProviderStatus;
  label: string;
  contactEmail: string;
}>) {
  const data = {
    id: crypto.randomUUID(),
    councilId: overrides?.councilId ?? "default",
    publicKey: overrides?.publicKey ?? Keypair.random().publicKey(),
    status: overrides?.status ?? ProviderStatus.ACTIVE,
    label: overrides?.label ?? "Test Provider",
    contactEmail: overrides?.contactEmail ?? "provider@example.com",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  };
  const [result] = await drizzleClient.insert(councilProvider).values(data).returning();
  return result;
}

export async function seedCustodialUser(overrides?: Partial<{
  councilId: string;
  externalId: string;
  channelContractId: string;
  p256PublicKeyHex: string;
  status: CustodialUserStatus;
  registeredByProvider: string;
}>) {
  const data = {
    id: crypto.randomUUID(),
    councilId: overrides?.councilId ?? "default",
    externalId: overrides?.externalId ?? `user-${crypto.randomUUID().slice(0, 8)}`,
    channelContractId: overrides?.channelContractId ?? testContractId(),
    p256PublicKeyHex: overrides?.p256PublicKeyHex ?? "04" + "a".repeat(128),
    status: overrides?.status ?? CustodialUserStatus.ACTIVE,
    registeredByProvider: overrides?.registeredByProvider ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  };
  const [result] = await drizzleClient.insert(custodialUser).values(data).returning();
  return result;
}

export async function seedEscrow(overrides?: Partial<{
  councilId: string;
  senderAddress: string;
  recipientAddress: string;
  amount: bigint;
  assetCode: string;
  channelContractId: string;
  status: EscrowStatus;
  submittedByProvider: string;
}>) {
  const data = {
    id: crypto.randomUUID(),
    councilId: overrides?.councilId ?? "default",
    senderAddress: overrides?.senderAddress ?? testAddress(),
    recipientAddress: overrides?.recipientAddress ?? testAddress(),
    amount: overrides?.amount ?? 1000n,
    assetCode: overrides?.assetCode ?? "XLM",
    channelContractId: overrides?.channelContractId ?? testContractId(),
    status: overrides?.status ?? EscrowStatus.HELD,
    submittedByProvider: overrides?.submittedByProvider ?? Keypair.random().publicKey(),
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  };
  const [result] = await drizzleClient.insert(councilEscrow).values(data).returning();
  return result;
}

export async function seedJoinRequest(overrides?: Partial<{
  councilId: string;
  publicKey: string;
  label: string;
  contactEmail: string;
  status: JoinRequestStatus;
}>) {
  const data = {
    id: crypto.randomUUID(),
    councilId: overrides?.councilId ?? "default",
    publicKey: overrides?.publicKey ?? Keypair.random().publicKey(),
    label: overrides?.label ?? "Test Provider Request",
    contactEmail: overrides?.contactEmail ?? "join@example.com",
    status: overrides?.status ?? JoinRequestStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
  };
  const [result] = await drizzleClient.insert(providerJoinRequest).values(data).returning();
  return result;
}

// ── Query helpers (for assertions) ──────────────────────────────────────

export async function getMetadata() {
  const [result] = await drizzleClient.select().from(councilMetadata);
  return result;
}

export async function getAllChannels() {
  return await drizzleClient.select().from(councilChannel);
}

export async function getAllProviders() {
  return await drizzleClient.select().from(councilProvider);
}

export async function getAllEscrows() {
  return await drizzleClient.select().from(councilEscrow);
}

export async function getAllJoinRequests() {
  return await drizzleClient.select().from(providerJoinRequest);
}

// ── Re-exports ──────────────────────────────────────────────────────────

export { drizzleClient, resetDb, closeDb, ensureInitialized };
export { ProviderStatus };
export { CustodialUserStatus };
export { EscrowStatus };
export { JoinRequestStatus };
