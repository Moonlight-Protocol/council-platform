import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import { CHANNEL_AUTH_ID, COUNCIL_SIGNER } from "@/config/env.ts";
import { LOG } from "@/config/logger.ts";

const metadataRepo = new CouncilMetadataRepository(drizzleClient);

/**
 * GET /council/metadata
 * Returns council metadata. Creates default record on first access.
 */
export const getMetadataHandler = async (ctx: Context) => {
  try {
    let metadata = await metadataRepo.getConfig();

    if (!metadata) {
      metadata = await metadataRepo.upsert({
        name: "Unnamed Council",
        channelAuthId: CHANNEL_AUTH_ID,
        councilPublicKey: COUNCIL_SIGNER.publicKey(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Council metadata retrieved",
      data: {
        name: metadata.name,
        description: metadata.description,
        contactEmail: metadata.contactEmail,
        channelAuthId: metadata.channelAuthId,
        councilPublicKey: metadata.councilPublicKey,
      },
    };
  } catch (error) {
    LOG.error("Failed to get council metadata", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve council metadata" };
  }
};

/**
 * PUT /council/metadata
 * Updates council metadata. Admin-only.
 */
export const putMetadataHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { name, description, contactEmail } = body;

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
      ctx.response.body = { message: "description must be at most 2000 characters" };
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

    const metadata = await metadataRepo.upsert({
      name: name.trim(),
      description: description?.trim() ?? null,
      contactEmail: contactEmail?.trim() ?? null,
      channelAuthId: CHANNEL_AUTH_ID,
      councilPublicKey: COUNCIL_SIGNER.publicKey(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    LOG.info("Council metadata updated", { name: metadata.name });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Council metadata updated",
      data: {
        name: metadata.name,
        description: metadata.description,
        contactEmail: metadata.contactEmail,
        channelAuthId: metadata.channelAuthId,
        councilPublicKey: metadata.councilPublicKey,
      },
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid request body" };
    } else {
      LOG.error("Failed to update metadata", { error: error instanceof Error ? error.message : String(error) });
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to update metadata" };
    }
  }
};

/**
 * DELETE /council/metadata
 * Deletes all council data (metadata, channels, jurisdictions). Admin-only.
 */
export const deleteMetadataHandler = async (ctx: Context) => {
  try {
    await metadataRepo.deleteAll();
    LOG.info("Council deleted");
    ctx.response.status = Status.OK;
    ctx.response.body = { message: "Council deleted" };
  } catch (error) {
    LOG.error("Failed to delete council", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to delete council" };
  }
};
