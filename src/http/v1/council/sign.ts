import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilProviderRepository } from "@/persistence/drizzle/repository/council-provider.repository.ts";
import { CustodialUserRepository } from "@/persistence/drizzle/repository/custodial-user.repository.ts";
import { ProviderStatus } from "@/persistence/drizzle/entity/council-provider.entity.ts";
import { CustodialUserStatus } from "@/persistence/drizzle/entity/custodial-user.entity.ts";
import { signWithDerivedKey } from "@/core/service/custody/key-derivation.service.ts";
import { registerCustodialUser, getUserPublicKeys } from "@/core/service/custody/custody.service.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import { LOG } from "@/config/logger.ts";

const providerRepo = new CouncilProviderRepository(drizzleClient);
const userRepo = new CustodialUserRepository(drizzleClient);

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const HEX_RE = /^[0-9a-f]+$/i;

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Hex string must have even length");
  }
  if (!HEX_RE.test(hex)) {
    throw new Error("Invalid hex characters");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Validates that the requesting session belongs to an active provider.
 */
async function validateProviderSession(session: JwtSessionData): Promise<string | null> {
  if (session.type !== "provider") return "Not a provider session";

  const provider = await providerRepo.findByPublicKey(session.sub);
  if (!provider) return "Provider not registered with this council";
  if (provider.status !== ProviderStatus.ACTIVE) return "Provider is not active";

  return null;
}

/**
 * POST /council/sign/register
 *
 * PP registers a non-custodial user with the council.
 * The council derives and stores the P256 root key for the user+channel.
 *
 * Body: { externalId: string, channelContractId: string }
 * Response: { userId: string, p256PublicKeyHex: string }
 */
export const postRegisterUserHandler = async (ctx: Context) => {
  try {
    const session = ctx.state.session as JwtSessionData;
    const providerError = await validateProviderSession(session);
    if (providerError) {
      ctx.response.status = Status.Forbidden;
      ctx.response.body = { message: providerError };
      return;
    }

    const body = await ctx.request.body.json();
    const { externalId, channelContractId } = body;

    if (!externalId || typeof externalId !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "externalId is required" };
      return;
    }

    if (!channelContractId || typeof channelContractId !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "channelContractId is required" };
      return;
    }

    const result = await registerCustodialUser({
      externalId,
      channelContractId,
      providerPublicKey: session.sub,
    });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "User registered",
      data: result,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid request body" };
    } else {
      LOG.error("Failed to register custodial user", {
        error: error instanceof Error ? error.message : String(error),
      });
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to register user" };
    }
  }
};

/**
 * POST /council/sign/keys
 *
 * PP requests derived P256 public keys for a user at specific UTXO indices.
 *
 * Body: { externalId: string, channelContractId: string, indices: number[] }
 * Response: { publicKeys: string[] }
 */
export const postGetKeysHandler = async (ctx: Context) => {
  try {
    const session = ctx.state.session as JwtSessionData;
    const providerError = await validateProviderSession(session);
    if (providerError) {
      ctx.response.status = Status.Forbidden;
      ctx.response.body = { message: providerError };
      return;
    }

    const body = await ctx.request.body.json();
    const { externalId, channelContractId, indices } = body;

    if (!externalId || !channelContractId || !Array.isArray(indices)) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "externalId, channelContractId, and indices are required" };
      return;
    }

    if (indices.length > 300) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Maximum 300 indices per request" };
      return;
    }

    const publicKeys = await getUserPublicKeys(externalId, channelContractId, indices);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Public keys derived",
      data: { publicKeys },
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid request body" };
    } else {
      LOG.error("Failed to derive public keys", {
        error: error instanceof Error ? error.message : String(error),
      });
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to derive public keys" };
    }
  }
};

/**
 * POST /council/sign/spend
 *
 * PP sends a spend request. The council signs the UTXO spend operations
 * with the derived P256 private keys and returns the signatures.
 *
 * Body: {
 *   channelContractId: string,
 *   spends: Array<{
 *     externalId: string,
 *     utxoIndex: number,
 *     message: string (hex-encoded message to sign)
 *   }>
 * }
 * Response: { signatures: string[] (hex-encoded DER signatures) }
 */
export const postSignSpendHandler = async (ctx: Context) => {
  try {
    const session = ctx.state.session as JwtSessionData;
    const providerError = await validateProviderSession(session);
    if (providerError) {
      ctx.response.status = Status.Forbidden;
      ctx.response.body = { message: providerError };
      return;
    }

    const body = await ctx.request.body.json();
    const { channelContractId, spends } = body;

    if (!channelContractId || typeof channelContractId !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "channelContractId is required" };
      return;
    }

    if (!Array.isArray(spends) || spends.length === 0) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "spends array is required and must not be empty" };
      return;
    }

    if (spends.length > 300) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Maximum 300 spends per request" };
      return;
    }

    const signatures: string[] = [];

    for (const spend of spends) {
      const { externalId, utxoIndex, message } = spend;

      if (!externalId || typeof utxoIndex !== "number" || !message) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "Each spend requires externalId, utxoIndex, and message" };
        return;
      }

      if (!Number.isInteger(utxoIndex) || utxoIndex < 0 || utxoIndex >= 300) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: `utxoIndex must be an integer 0-299, got ${utxoIndex}` };
        return;
      }

      // Verify user exists and is active
      const user = await userRepo.findByExternalIdAndChannel(externalId, channelContractId);
      if (!user) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: `User not registered for this channel` };
        return;
      }

      if (user.status !== CustodialUserStatus.ACTIVE) {
        ctx.response.status = Status.Forbidden;
        ctx.response.body = { message: "User is suspended" };
        return;
      }

      // Only the provider that registered this user can request signatures
      if (user.registeredByProvider && user.registeredByProvider !== session.sub) {
        ctx.response.status = Status.Forbidden;
        ctx.response.body = { message: "Not authorized to sign for this user" };
        return;
      }

      let messageBytes: Uint8Array;
      try {
        messageBytes = hexToBytes(message);
      } catch {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "message must be a valid hex string with even length" };
        return;
      }
      const signature = await signWithDerivedKey(
        channelContractId,
        externalId,
        utxoIndex,
        messageBytes,
      );
      signatures.push(bytesToHex(signature));
    }

    LOG.info("Spend signatures generated", {
      channelContractId,
      spendCount: spends.length,
      provider: session.sub,
    });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Signatures generated",
      data: { signatures },
    };
  } catch (error) {
    LOG.error("Failed to sign spend operations", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to generate signatures" };
  }
};
