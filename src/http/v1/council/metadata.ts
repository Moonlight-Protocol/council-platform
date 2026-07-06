import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import { encryptSecret } from "@/core/crypto/encrypt-secret.ts";
import { SERVICE_AUTH_SECRET } from "@/config/env.ts";
import * as E from "@/http/v1/error.ts";
import type { Logger } from "@/utils/logger/index.ts";

const metadataRepo = new CouncilMetadataRepository(drizzleClient);

function getCouncilId(ctx: Context): string | null {
  return ctx.request.url.searchParams.get("councilId");
}

/**
 * GET /council/metadata?councilId=...
 * Returns council metadata for a specific council.
 */
export function handleGetMetadata(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getMetadata");

  return async (ctx) => {
    log.info("getMetadata");
    const councilId = getCouncilId(ctx);
    if (!councilId) {
      throw new E.RESOURCE_ID_REQUIRED("councilId query parameter");
    }

    const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
    const metadata = await metadataRepo.getByIdAndOwner(
      councilId,
      ownerPublicKey,
    );

    if (!metadata) {
      throw new E.RESOURCE_NOT_FOUND("Council not found");
    }

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Council metadata retrieved",
      data: {
        councilId: metadata.id,
        name: metadata.name,
        description: metadata.description,
        contactEmail: metadata.contactEmail,
        councilPublicKey: metadata.councilPublicKey,
      },
    };
  };
}

/**
 * GET /council/list
 * Lists all councils managed by this platform.
 */
export function handleListCouncils(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("listCouncils");

  return async (ctx) => {
    log.info("listCouncils");
    const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
    const councils = await metadataRepo.listByOwner(ownerPublicKey);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Councils retrieved",
      data: councils.map((c) => ({
        councilId: c.id,
        name: c.name,
        description: c.description,
        contactEmail: c.contactEmail,
        councilPublicKey: c.councilPublicKey,
      })),
    };
  };
}

/**
 * PUT /council/metadata
 * Creates or updates council metadata.
 * Body must include councilId (the channelAuthId).
 */
export function handlePutMetadata(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("putMetadata");

  return async (ctx) => {
    log.info("putMetadata");
    let body;
    try {
      body = await ctx.request.body.json();
    } catch (error) {
      throw new E.INVALID_REQUEST_BODY(error);
    }
    const { councilId, name, description, contactEmail, opexPublicKey } = body;

    if (!councilId || typeof councilId !== "string") {
      throw new E.RESOURCE_ID_REQUIRED("councilId");
    }

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      throw new E.VALIDATION_FAILED("name is required");
    }

    if (name.length > 200) {
      throw new E.VALIDATION_FAILED("name must be at most 200 characters");
    }

    if (description && typeof description !== "string") {
      throw new E.VALIDATION_FAILED("description must be a string");
    }
    if (description && description.length > 2000) {
      throw new E.VALIDATION_FAILED(
        "description must be at most 2000 characters",
      );
    }

    if (contactEmail && typeof contactEmail !== "string") {
      throw new E.VALIDATION_FAILED("contactEmail must be a string");
    }
    if (contactEmail && contactEmail.length > 200) {
      throw new E.VALIDATION_FAILED(
        "contactEmail must be at most 200 characters",
      );
    }

    const sessionPublicKey = (ctx.state.session as { sub: string })?.sub;

    const updateData: Record<string, unknown> = {
      name: name.trim(),
    };
    if (description !== undefined) {
      updateData.description = description?.trim() ?? null;
    }
    if (contactEmail !== undefined) {
      updateData.contactEmail = contactEmail?.trim() ?? null;
    }
    if (sessionPublicKey) updateData.councilPublicKey = sessionPublicKey;
    if (opexPublicKey) {
      try {
        const { Keypair } = await import("stellar-sdk");
        Keypair.fromPublicKey(opexPublicKey.trim());
      } catch {
        throw new E.VALIDATION_FAILED(
          "opexPublicKey must be a valid Stellar public key",
        );
      }
      updateData.opexPublicKey = opexPublicKey.trim();
    }

    // Verify ownership if council already exists
    const existing = await metadataRepo.getByIdIncludingDeleted(councilId);
    if (existing && existing.councilPublicKey !== sessionPublicKey) {
      log.debug("councilId", councilId);
      log.debug("existingOwner", existing.councilPublicKey);
      log.debug("sessionOwner", sessionPublicKey);
      log.error(
        new Error("ownership mismatch"),
        "council ownership mismatch on update",
      );
      throw new E.RESOURCE_NOT_FOUND("Council not found");
    }

    // Generate per-council derivation root on first creation only.
    // The root is random 32 bytes used as the HKDF root for custodial user keys.
    // Stored encrypted at rest with SERVICE_AUTH_SECRET.
    //
    // For updates, carry the existing root through to the upsert so the
    // ON CONFLICT insert row satisfies the NOT NULL constraint on
    // encrypted_derivation_root. Never overwrite an existing root.
    const isNewCouncil = !existing;
    if (isNewCouncil) {
      const root = crypto.getRandomValues(new Uint8Array(32));
      updateData.encryptedDerivationRoot = await encryptSecret(
        root,
        SERVICE_AUTH_SECRET,
      );
      root.fill(0); // Best-effort zeroization
    } else {
      updateData.encryptedDerivationRoot = existing.encryptedDerivationRoot;
    }

    const metadata = await metadataRepo.upsert(councilId, updateData);

    // The event watcher service polls the DB on a periodic interval
    // and starts a watcher for any council that doesn't yet have one.
    // No direct call is needed here — keeping the handler free of
    // async side effects (and trivially testable).

    log.debug("councilId", councilId);
    log.debug("name", metadata.name);
    log.event("council metadata updated");

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Council metadata updated",
      data: {
        councilId: metadata.id,
        name: metadata.name,
        description: metadata.description,
        contactEmail: metadata.contactEmail,
        councilPublicKey: metadata.councilPublicKey,
      },
    };
  };
}

/**
 * DELETE /council/metadata?councilId=...
 * Deletes a council and all related data.
 */
export function handleDeleteMetadata(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("deleteMetadata");

  return async (ctx) => {
    log.info("deleteMetadata");
    const councilId = getCouncilId(ctx);
    if (!councilId) {
      throw new E.RESOURCE_ID_REQUIRED("councilId query parameter");
    }

    // Verify ownership before deleting
    const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
    const council = await metadataRepo.getByIdAndOwner(
      councilId,
      ownerPublicKey,
    );
    if (!council) {
      throw new E.RESOURCE_NOT_FOUND("Council not found");
    }

    await metadataRepo.deleteCouncil(councilId);
    log.debug("councilId", councilId);
    log.event("council deleted");
    ctx.response.status = Status.OK;
    ctx.response.body = { message: "Council deleted" };
  };
}
