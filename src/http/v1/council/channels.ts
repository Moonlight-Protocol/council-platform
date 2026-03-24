import { type Context, Status } from "@oak/oak";
import { StrKey } from "@colibri/core";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import { queryChannelState } from "@/core/service/channel/channel-state.service.ts";
import { LOG } from "@/config/logger.ts";

const channelRepo = new CouncilChannelRepository(drizzleClient);

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

/**
 * GET /council/channels
 * Lists all channels governed by this council.
 */
export const listChannelsHandler = async (ctx: Context) => {
  try {
    const channels = await channelRepo.listAll();

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

/**
 * POST /council/channels
 * Registers a new channel. Admin-only.
 */
export const addChannelHandler = async (ctx: Context) => {
  try {
    const body = await ctx.request.body.json();
    const { channelContractId, assetCode, assetContractId, label } = body;

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

    const existing = await channelRepo.findByContractId(channelContractId);
    if (existing) {
      ctx.response.status = Status.Conflict;
      ctx.response.body = { message: "Channel with this contract ID already exists" };
      return;
    }

    const channel = await channelRepo.create({
      id: crypto.randomUUID(),
      channelContractId,
      assetCode: assetCode.trim(),
      assetContractId: assetContractId?.trim() ?? null,
      label: label?.trim() ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    LOG.info("Channel added", { channelContractId, assetCode });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Channel added",
      data: formatChannel(channel),
    };
  } catch {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = { message: "Invalid request body" };
  }
};

type RouteParams = { id?: string };

/**
 * GET /council/channels/:id
 * Gets channel details with refreshed on-chain state.
 */
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

    // Refresh on-chain state
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
      // Return cached state if RPC fails
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

/**
 * DELETE /council/channels/:id
 * Removes a channel. Admin-only.
 */
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

    await channelRepo.delete(id);

    LOG.info("Channel removed", { id, channelContractId: channel.channelContractId });

    ctx.response.status = Status.OK;
    ctx.response.body = { message: "Channel removed" };
  } catch (error) {
    LOG.error("Failed to remove channel", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to remove channel" };
  }
};
