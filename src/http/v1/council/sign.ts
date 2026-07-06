import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilProviderRepository } from "@/persistence/drizzle/repository/council-provider.repository.ts";
import { CustodialUserRepository } from "@/persistence/drizzle/repository/custodial-user.repository.ts";
import { ProviderStatus } from "@/persistence/drizzle/entity/council-provider.entity.ts";
import { CustodialUserStatus } from "@/persistence/drizzle/entity/custodial-user.entity.ts";
import { signWithDerivedKey } from "@/core/service/custody/key-derivation.service.ts";
import {
  getUserPublicKeys,
  registerCustodialUser,
} from "@/core/service/custody/custody.service.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import * as E from "@/http/v1/error.ts";
import type { Logger } from "@/utils/logger/index.ts";

const providerRepo = new CouncilProviderRepository(drizzleClient);
const userRepo = new CustodialUserRepository(drizzleClient);

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const HEX_RE = /^[0-9a-f]+$/i;

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new E.VALIDATION_FAILED("Hex string must have even length");
  }
  if (!HEX_RE.test(hex)) {
    throw new E.VALIDATION_FAILED("Invalid hex characters");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Validates that the requesting session belongs to an active provider for this council.
 * Authorization is membership-based: any wallet that is an active member of the council
 * can use these endpoints.
 */
async function validateProviderSession(
  councilId: string,
  session: JwtSessionData,
  deps: { log: Logger },
): Promise<string | null> {
  const log = deps.log.scope("validateProviderSession");
  log.info("validateProviderSession");
  log.debug("councilId", councilId);
  log.debug("providerPublicKey", session.sub);

  log.event("looking up provider record");
  const provider = await providerRepo.findByPublicKey(councilId, session.sub);
  if (!provider) {
    log.event("provider not registered");
    return "Provider not registered with this council";
  }
  if (provider.status !== ProviderStatus.ACTIVE) {
    log.event("provider not active");
    return "Provider is not active";
  }

  log.event("provider session valid");
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
export function handlePostRegisterUser(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("postRegisterUser");

  return async (ctx) => {
    log.info("postRegisterUser");
    const session = ctx.state.session as JwtSessionData;

    let body;
    try {
      body = await ctx.request.body.json();
    } catch (error) {
      throw new E.INVALID_REQUEST_BODY(error);
    }
    const { councilId, externalId, channelContractId } = body;

    if (!councilId || typeof councilId !== "string") {
      throw new E.VALIDATION_FAILED("councilId is required");
    }

    const providerError = await validateProviderSession(
      councilId,
      session,
      deps,
    );
    if (providerError) {
      throw new E.FORBIDDEN(providerError);
    }

    if (!externalId || typeof externalId !== "string") {
      throw new E.VALIDATION_FAILED("externalId is required");
    }

    if (!channelContractId || typeof channelContractId !== "string") {
      throw new E.VALIDATION_FAILED("channelContractId is required");
    }

    const result = await registerCustodialUser({
      councilId,
      externalId,
      channelContractId,
      providerPublicKey: session.sub,
    }, { log });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "User registered",
      data: result,
    };
  };
}

/**
 * POST /council/sign/keys
 *
 * PP requests derived P256 public keys for a user at specific UTXO indices.
 *
 * Body: { externalId: string, channelContractId: string, indices: number[] }
 * Response: { publicKeys: string[] }
 */
export function handlePostGetKeys(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("postGetKeys");

  return async (ctx) => {
    log.info("postGetKeys");
    const session = ctx.state.session as JwtSessionData;

    let body;
    try {
      body = await ctx.request.body.json();
    } catch (error) {
      throw new E.INVALID_REQUEST_BODY(error);
    }
    const { councilId, externalId, channelContractId, indices } = body;

    if (!councilId || typeof councilId !== "string") {
      throw new E.VALIDATION_FAILED("councilId is required");
    }

    const providerError = await validateProviderSession(
      councilId,
      session,
      deps,
    );
    if (providerError) {
      throw new E.FORBIDDEN(providerError);
    }

    if (!externalId || !channelContractId || !Array.isArray(indices)) {
      throw new E.VALIDATION_FAILED(
        "externalId, channelContractId, and indices are required",
      );
    }

    if (indices.length > 300) {
      throw new E.VALIDATION_FAILED("Maximum 300 indices per request");
    }

    const publicKeys = await getUserPublicKeys(
      councilId,
      externalId,
      channelContractId,
      indices,
      deps,
    );

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Public keys derived",
      data: { publicKeys },
    };
  };
}

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
export function handlePostSignSpend(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("postSignSpend");

  return async (ctx) => {
    log.info("postSignSpend");
    const session = ctx.state.session as JwtSessionData;

    let body;
    try {
      body = await ctx.request.body.json();
    } catch (error) {
      throw new E.INVALID_REQUEST_BODY(error);
    }
    const { councilId, channelContractId, spends } = body;

    if (!councilId || typeof councilId !== "string") {
      throw new E.VALIDATION_FAILED("councilId is required");
    }

    const providerError = await validateProviderSession(
      councilId,
      session,
      deps,
    );
    if (providerError) {
      throw new E.FORBIDDEN(providerError);
    }

    if (!channelContractId || typeof channelContractId !== "string") {
      throw new E.VALIDATION_FAILED("channelContractId is required");
    }

    if (!Array.isArray(spends) || spends.length === 0) {
      throw new E.VALIDATION_FAILED(
        "spends array is required and must not be empty",
      );
    }

    if (spends.length > 300) {
      throw new E.VALIDATION_FAILED("Maximum 300 spends per request");
    }

    const signatures: string[] = [];

    for (const spend of spends) {
      const { externalId, utxoIndex, message } = spend;

      if (!externalId || typeof utxoIndex !== "number" || !message) {
        throw new E.VALIDATION_FAILED(
          "Each spend requires externalId, utxoIndex, and message",
        );
      }

      if (!Number.isInteger(utxoIndex) || utxoIndex < 0 || utxoIndex >= 300) {
        throw new E.VALIDATION_FAILED(
          `utxoIndex must be an integer 0-299, got ${utxoIndex}`,
        );
      }

      // Verify user exists and is active
      const user = await userRepo.findByExternalIdAndChannel(
        externalId,
        channelContractId,
      );
      if (!user) {
        throw new E.RESOURCE_NOT_FOUND("User not registered for this channel");
      }

      if (user.status !== CustodialUserStatus.ACTIVE) {
        throw new E.FORBIDDEN("User is suspended");
      }

      // Only the provider that registered this user can request signatures
      if (
        user.registeredByProvider &&
        user.registeredByProvider !== session.sub
      ) {
        throw new E.FORBIDDEN("Not authorized to sign for this user");
      }

      let messageBytes: Uint8Array;
      try {
        messageBytes = hexToBytes(message);
      } catch {
        throw new E.VALIDATION_FAILED(
          "message must be a valid hex string with even length",
        );
      }
      const signature = await signWithDerivedKey(
        councilId,
        channelContractId,
        externalId,
        utxoIndex,
        messageBytes,
        deps,
      );
      signatures.push(bytesToHex(signature));
    }

    log.debug("channelContractId", channelContractId);
    log.debug("spendCount", spends.length);
    log.debug("provider", session.sub);
    log.event("spend signatures generated");

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Signatures generated",
      data: { signatures },
    };
  };
}
