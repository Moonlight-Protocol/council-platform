import { type Context, Status } from "@oak/oak";
import { Keypair } from "stellar-sdk";
import type { ProviderJoinRequestRepository } from "@/persistence/drizzle/repository/provider-join-request.repository.ts";
import { JoinRequestStatus } from "@/persistence/drizzle/entity/provider-join-request.entity.ts";
import {
  type SignedPayload,
  verifyPayload,
} from "@/core/crypto/signed-payload.ts";
import * as E from "@/http/v1/error.ts";
import type { Logger } from "@/utils/logger/index.ts";

interface JoinRequestPayload {
  publicKey: string;
  councilId?: string;
  label?: string;
  contactEmail?: string;
  jurisdictions?: string[];
  callbackEndpoint?: string;
}

/**
 * Creates a POST /public/provider/join-request handler.
 * Accepts either a plain body or a SignedPayload envelope.
 */
export function createPostJoinRequestHandler(
  joinRequestRepo: ProviderJoinRequestRepository,
  deps: { log: Logger },
) {
  const log = deps.log.scope("postJoinRequest");

  return async (ctx: Context) => {
    log.info("postJoinRequest");
    let body;
    try {
      body = await ctx.request.body.json();
    } catch (error) {
      throw new E.INVALID_REQUEST_BODY(error);
    }

    // Determine if this is a signed envelope or a plain request
    let data: JoinRequestPayload;
    let signature: string | null = null;

    if (
      body.payload != null && typeof body.payload === "object" &&
      typeof body.signature === "string" &&
      typeof body.publicKey === "string" &&
      typeof body.timestamp === "number"
    ) {
      // Signed envelope from provider-platform — discriminated by payload being
      // an object (not a primitive) plus the presence of a numeric timestamp.
      // A plain join request may contain fields named payload/signature/publicKey
      // as strings, but will never have this exact shape.
      const envelope = body as SignedPayload<JoinRequestPayload>;
      const valid = await verifyPayload(envelope);
      if (!valid) {
        throw new E.VALIDATION_FAILED("Invalid signature");
      }
      data = envelope.payload;
      signature = envelope.signature;

      // Ensure envelope publicKey matches payload publicKey
      if (envelope.publicKey !== data.publicKey) {
        throw new E.VALIDATION_FAILED(
          "Signer does not match payload publicKey",
        );
      }
    } else {
      // Plain request (backwards-compatible with council-console #/join form)
      data = body as JoinRequestPayload;
    }

    const {
      publicKey,
      label,
      contactEmail,
      jurisdictions,
      callbackEndpoint,
    } = data;
    // Provider-platform includes its base URL alongside the signed envelope
    const providerUrl: string | null = typeof body.providerUrl === "string"
      ? body.providerUrl.trim()
      : null;
    // For signed payloads, councilId must come from inside the verified envelope.
    // Query param fallback only for unsigned plain requests.
    const councilId = signature
      ? (data.councilId || "")
      : (data.councilId || ctx.request.url.searchParams.get("councilId") ||
        "");
    if (!councilId) {
      throw new E.VALIDATION_FAILED("councilId is required");
    }

    if (!publicKey || typeof publicKey !== "string") {
      throw new E.VALIDATION_FAILED("publicKey is required");
    }

    try {
      Keypair.fromPublicKey(publicKey);
    } catch {
      throw new E.VALIDATION_FAILED("Invalid Stellar public key format");
    }

    if (label && typeof label !== "string") {
      throw new E.VALIDATION_FAILED("label must be a string");
    }
    if (label && label.length > 200) {
      throw new E.VALIDATION_FAILED("label must be at most 200 characters");
    }

    if (contactEmail && typeof contactEmail !== "string") {
      throw new E.VALIDATION_FAILED("contactEmail must be a string");
    }
    if (contactEmail && contactEmail.length > 200) {
      throw new E.VALIDATION_FAILED(
        "contactEmail must be at most 200 characters",
      );
    }

    if (jurisdictions && !Array.isArray(jurisdictions)) {
      throw new E.VALIDATION_FAILED(
        "jurisdictions must be an array of country codes",
      );
    }
    if (jurisdictions && jurisdictions.length > 50) {
      throw new E.VALIDATION_FAILED(
        "jurisdictions must have at most 50 entries",
      );
    }

    if (callbackEndpoint && typeof callbackEndpoint !== "string") {
      throw new E.VALIDATION_FAILED("callbackEndpoint must be a string");
    }
    if (callbackEndpoint && callbackEndpoint.length > 500) {
      throw new E.VALIDATION_FAILED(
        "callbackEndpoint must be at most 500 characters",
      );
    }
    if (callbackEndpoint) {
      let parsed: URL;
      try {
        parsed = new URL(callbackEndpoint);
      } catch {
        throw new E.VALIDATION_FAILED(
          "callbackEndpoint must be a valid HTTP(S) URL",
        );
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new E.VALIDATION_FAILED(
          "callbackEndpoint must be a valid HTTP(S) URL",
        );
      }
    }

    // Check for existing pending request for this council
    const existing = await joinRequestRepo.findPendingByPublicKey(
      councilId,
      publicKey,
    );
    if (existing) {
      throw new E.RESOURCE_CONFLICT(
        "A pending join request already exists for this public key",
      );
    }

    const request = await joinRequestRepo.create({
      id: crypto.randomUUID(),
      councilId,
      publicKey,
      label: label?.trim() ?? null,
      contactEmail: contactEmail?.trim() ?? null,
      jurisdictions: jurisdictions ? JSON.stringify(jurisdictions) : null,
      callbackEndpoint: callbackEndpoint?.trim() ?? null,
      providerUrl,
      signature,
      status: JoinRequestStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    log.debug("publicKey", publicKey);
    log.debug("signed", !!signature);
    log.event("join request submitted");

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Join request submitted",
      data: {
        id: request.id,
        publicKey: request.publicKey,
        status: request.status,
      },
    };
  };
}
