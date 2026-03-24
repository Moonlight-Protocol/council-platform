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
        website: metadata.website,
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
    const { name, description, website, contactEmail } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "name is required" };
      return;
    }

    if (name.length > 100) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "name must be at most 100 characters" };
      return;
    }

    if (description && typeof description === "string" && description.length > 500) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "description must be at most 500 characters" };
      return;
    }

    const metadata = await metadataRepo.upsert({
      name: name.trim(),
      description: description?.trim() ?? null,
      website: website?.trim() ?? null,
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
        website: metadata.website,
        contactEmail: metadata.contactEmail,
        channelAuthId: metadata.channelAuthId,
        councilPublicKey: metadata.councilPublicKey,
      },
    };
  } catch {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = { message: "Invalid request body" };
  }
};
