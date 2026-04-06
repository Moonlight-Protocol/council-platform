import { type Context, Status } from "@oak/oak";
import { StrKey } from "@colibri/core";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import { KnownAssetRepository } from "@/persistence/drizzle/repository/known-asset.repository.ts";
import { queryChannelState } from "@/core/service/channel/channel-state.service.ts";
import { requireCouncilId, requireCouncilOwnership } from "./helpers.ts";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import { LOG } from "@/config/logger.ts";

const metadataRepo = new CouncilMetadataRepository(drizzleClient);

const channelRepo = new CouncilChannelRepository(drizzleClient);
const knownAssetRepo = new KnownAssetRepository(drizzleClient);

function formatChannel(ch: { id: string; channelContractId: string; assetCode: string; assetContractId: string | null; label: string | null; totalDeposited: bigint | null; totalWithdrawn: bigint | null; utxoCount: bigint | null; lastSyncedAt: Date | null }) {
  return {
    id: ch.id,
    channelContractId: ch.channelContractId,
    assetCode: ch.assetCode,
    assetContractId: ch.assetContractId,
    label: ch.label,
    state: {
      totalDeposited: ch.totalDeposited?.toString() ?? null,
      totalWithdrawn: ch.totalWithdrawn?.toString() ?? null,
      utxoCount: ch.utxoCount?.toString() ?? null,
      lastSyncedAt: ch.lastSyncedAt?.toISOString() ?? null,
    },
  };
}

export const listChannelsHandler = async (ctx: Context) => {
  try {
    const councilId = requireCouncilId(ctx);
    if (!councilId) return;
    if (!await requireCouncilOwnership(ctx, councilId, metadataRepo)) return;

    const channels = await channelRepo.listAll(councilId);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Channels retrieved",
      data: channels.map(formatChannel),
    };
  } catch (error) {
    LOG.error("Failed to list channels", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve channels" };
  }
};

export const addChannelHandler = async (ctx: Context) => {
  try {
    const councilId = requireCouncilId(ctx);
    if (!councilId) return;
    if (!await requireCouncilOwnership(ctx, councilId, metadataRepo)) return;

    const body = await ctx.request.body.json();
    const { channelContractId, assetCode, assetContractId, issuerAddress, label } = body;

    if (!channelContractId || typeof channelContractId !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "channelContractId is required" };
      return;
    }

    if (!StrKey.isValidContractId(channelContractId)) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid Soroban contract ID format" };
      return;
    }

    if (!assetCode || typeof assetCode !== "string") {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "assetCode is required" };
      return;
    }

    if (assetCode.length > 12 || !/^[a-zA-Z0-9]+$/.test(assetCode)) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "assetCode must be 1-12 alphanumeric characters" };
      return;
    }

    if (assetContractId && typeof assetContractId === "string" && !StrKey.isValidContractId(assetContractId)) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid asset contract ID format" };
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

    const existing = await channelRepo.findByContractId(councilId, channelContractId);
    if (existing) {
      ctx.response.status = Status.Conflict;
      ctx.response.body = { message: "Channel with this contract ID already exists" };
      return;
    }

    const channel = await channelRepo.create({
      id: crypto.randomUUID(),
      councilId,
      channelContractId,
      assetCode: assetCode.trim(),
      assetContractId: assetContractId?.trim() ?? null,
      label: label?.trim() ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    try {
      await knownAssetRepo.upsert(assetCode.trim(), (issuerAddress || "").trim());
    } catch { /* best effort */ }

    LOG.info("Channel added", { councilId, channelContractId, assetCode });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Channel added",
      data: formatChannel(channel),
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid request body" };
    } else {
      LOG.error("Failed to add channel", {
        error: error instanceof Error ? error.message : String(error),
      });
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to add channel" };
    }
  }
};

type RouteParams = { id?: string };

export const getChannelHandler = async (ctx: Context) => {
  try {
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const id = params?.id;

    if (!id) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Channel ID is required" };
      return;
    }

    const channel = await channelRepo.findById(id);
    if (!channel) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Channel not found" };
      return;
    }

    if (!await requireCouncilOwnership(ctx, channel.councilId, metadataRepo)) return;

    try {
      const onChainState = await queryChannelState(channel.channelContractId);

      await channelRepo.update(channel.id, {
        totalDeposited: onChainState.totalDeposited,
        totalWithdrawn: onChainState.totalWithdrawn,
        utxoCount: onChainState.utxoCount,
        lastSyncedAt: new Date(),
      });

      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Channel retrieved",
        data: {
          ...formatChannel(channel),
          state: {
            totalDeposited: onChainState.totalDeposited?.toString() ?? null,
            totalWithdrawn: onChainState.totalWithdrawn?.toString() ?? null,
            utxoCount: onChainState.utxoCount?.toString() ?? null,
            lastSyncedAt: new Date().toISOString(),
            ledgerSequence: onChainState.ledgerSequence,
          },
        },
      };
    } catch {
      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Channel retrieved (cached state, RPC unavailable)",
        data: formatChannel(channel),
      };
    }
  } catch (error) {
    LOG.error("Failed to get channel", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve channel" };
  }
};

export const removeChannelHandler = async (ctx: Context) => {
  try {
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const id = params?.id;

    if (!id) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Channel ID is required" };
      return;
    }

    const channel = await channelRepo.findById(id);
    if (!channel) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Channel not found" };
      return;
    }

    if (!await requireCouncilOwnership(ctx, channel.councilId, metadataRepo)) return;

    await channelRepo.update(id, { deletedAt: new Date() });

    LOG.info("Channel disabled", { id, channelContractId: channel.channelContractId });

    ctx.response.status = Status.OK;
    ctx.response.body = { message: "Channel disabled" };
  } catch (error) {
    LOG.error("Failed to disable channel", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to disable channel" };
  }
};

export const enableChannelHandler = async (ctx: Context) => {
  try {
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const id = params?.id;

    if (!id) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Channel ID is required" };
      return;
    }

    const channel = await channelRepo.findByIdIncludeDeleted(id);
    if (!channel || !channel.deletedAt) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Disabled channel not found" };
      return;
    }

    if (!await requireCouncilOwnership(ctx, channel.councilId, metadataRepo)) return;

    await channelRepo.restore(id);

    LOG.info("Channel re-enabled", { id, channelContractId: channel.channelContractId });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Channel re-enabled",
      data: formatChannel({ ...channel, deletedAt: null } as typeof channel),
    };
  } catch (error) {
    LOG.error("Failed to re-enable channel", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to re-enable channel" };
  }
};

export const listDisabledChannelsHandler = async (ctx: Context) => {
  try {
    const councilId = requireCouncilId(ctx);
    if (!councilId) return;
    if (!await requireCouncilOwnership(ctx, councilId, metadataRepo)) return;

    const channels = await channelRepo.listDisabled(councilId);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Disabled channels retrieved",
      data: channels.map(formatChannel),
    };
  } catch (error) {
    LOG.error("Failed to list disabled channels", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve disabled channels" };
  }
};
