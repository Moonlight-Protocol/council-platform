import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import { encryptSecret } from "@/core/crypto/encrypt-secret.ts";
import { SERVICE_AUTH_SECRET } from "@/config/env.ts";
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
    try {
      const councilId = getCouncilId(ctx);
      if (!councilId) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "councilId query parameter is required",
        };
        return;
      }

      const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
      const metadata = await metadataRepo.getByIdAndOwner(
        councilId,
        ownerPublicKey,
      );

      if (!metadata) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Council not found" };
        return;
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
    } catch (error) {
      log.error(error, "failed to get council metadata");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to retrieve council metadata" };
    }
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
    try {
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
    } catch (error) {
      log.error(error, "failed to list councils");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to list councils" };
    }
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
    try {
      const body = await ctx.request.body.json();
      const { councilId, name, description, contactEmail, opexPublicKey } =
        body;

      if (!councilId || typeof councilId !== "string") {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "councilId is required" };
        return;
      }

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "name is required" };
        return;
      }

      if (name.length > 200) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "name must be at most 200 characters" };
        return;
      }

      if (description && typeof description !== "string") {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "description must be a string" };
        return;
      }
      if (description && description.length > 2000) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "description must be at most 2000 characters",
        };
        return;
      }

      if (contactEmail && typeof contactEmail !== "string") {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "contactEmail must be a string" };
        return;
      }
      if (contactEmail && contactEmail.length > 200) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "contactEmail must be at most 200 characters",
        };
        return;
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
          ctx.response.status = Status.BadRequest;
          ctx.response.body = {
            message: "opexPublicKey must be a valid Stellar public key",
          };
          return;
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
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Council not found" };
        return;
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
    } catch (error) {
      if (error instanceof SyntaxError) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "Invalid request body" };
      } else {
        log.error(error, "failed to update metadata");
        ctx.response.status = Status.InternalServerError;
        ctx.response.body = { message: "Failed to update metadata" };
      }
    }
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
    try {
      const councilId = getCouncilId(ctx);
      if (!councilId) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "councilId query parameter is required",
        };
        return;
      }

      // Verify ownership before deleting
      const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
      const council = await metadataRepo.getByIdAndOwner(
        councilId,
        ownerPublicKey,
      );
      if (!council) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: "Council not found" };
        return;
      }

      await metadataRepo.deleteCouncil(councilId);
      log.debug("councilId", councilId);
      log.event("council deleted");
      ctx.response.status = Status.OK;
      ctx.response.body = { message: "Council deleted" };
    } catch (error) {
      log.error(error, "failed to delete council");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to delete council" };
    }
  };
}
