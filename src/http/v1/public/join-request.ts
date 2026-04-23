import { type Context, Status } from "@oak/oak";
import { Keypair } from "stellar-sdk";
import type { ProviderJoinRequestRepository } from "@/persistence/drizzle/repository/provider-join-request.repository.ts";
import { JoinRequestStatus } from "@/persistence/drizzle/entity/provider-join-request.entity.ts";
import { verifyPayload, type SignedPayload } from "@/core/crypto/signed-payload.ts";
import { LOG } from "@/config/logger.ts";

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
export function createPostJoinRequestHandler(joinRequestRepo: ProviderJoinRequestRepository) {
  return async (ctx: Context) => {
    try {
      const body = await ctx.request.body.json();

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
          ctx.response.status = Status.BadRequest;
          ctx.response.body = { message: "Invalid signature" };
          return;
        }
        data = envelope.payload;
        signature = envelope.signature;

        // Ensure envelope publicKey matches payload publicKey
        if (envelope.publicKey !== data.publicKey) {
          ctx.response.status = Status.BadRequest;
          ctx.response.body = { message: "Signer does not match payload publicKey" };
          return;
        }
      } else {
        // Plain request (backwards-compatible with council-console #/join form)
        data = body as JoinRequestPayload;
      }

      const { publicKey, label, contactEmail, jurisdictions, callbackEndpoint } = data;
      // Provider-platform includes its base URL alongside the signed envelope
      const providerUrl: string | null = typeof body.providerUrl === "string" ? body.providerUrl.trim() : null;
      // For signed payloads, councilId must come from inside the verified envelope.
      // Query param fallback only for unsigned plain requests.
      const councilId = signature
        ? (data.councilId || "")
        : (data.councilId || ctx.request.url.searchParams.get("councilId") || "");
      if (!councilId) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "councilId is required" };
        return;
      }

      if (!publicKey || typeof publicKey !== "string") {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "publicKey is required" };
        return;
      }

      try {
        Keypair.fromPublicKey(publicKey);
      } catch {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "Invalid Stellar public key format" };
        return;
      }

      if (label && typeof label !== "string") {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "label must be a string" };
        return;
      }
      if (label && label.length > 200) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "label must be at most 200 characters" };
        return;
      }

      if (contactEmail && typeof contactEmail !== "string") {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "contactEmail must be a string" };
        return;
      }
      if (contactEmail && contactEmail.length > 200) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "contactEmail must be at most 200 characters" };
        return;
      }

      if (jurisdictions && !Array.isArray(jurisdictions)) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "jurisdictions must be an array of country codes" };
        return;
      }
      if (jurisdictions && jurisdictions.length > 50) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "jurisdictions must have at most 50 entries" };
        return;
      }

      if (callbackEndpoint && typeof callbackEndpoint !== "string") {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "callbackEndpoint must be a string" };
        return;
      }
      if (callbackEndpoint && callbackEndpoint.length > 500) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "callbackEndpoint must be at most 500 characters" };
        return;
      }
      if (callbackEndpoint) {
        try {
          const parsed = new URL(callbackEndpoint);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new Error("bad protocol");
          }
        } catch {
          ctx.response.status = Status.BadRequest;
          ctx.response.body = { message: "callbackEndpoint must be a valid HTTP(S) URL" };
          return;
        }
      }

      // Check for existing pending request for this council
      const existing = await joinRequestRepo.findPendingByPublicKey(councilId, publicKey);
      if (existing) {
        ctx.response.status = Status.Conflict;
        ctx.response.body = { message: "A pending join request already exists for this public key" };
        return;
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

      LOG.info("Join request submitted", { publicKey, signed: !!signature });

      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Join request submitted",
        data: {
          id: request.id,
          publicKey: request.publicKey,
          status: request.status,
        },
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "Invalid request body" };
      } else {
        LOG.error("Failed to create join request", { error: error instanceof Error ? error.message : String(error) });
        ctx.response.status = Status.InternalServerError;
        ctx.response.body = { message: "Failed to submit join request" };
      }
    }
  };
}
