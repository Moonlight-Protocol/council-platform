import { type Context, Status } from "@oak/oak";
import { StrKey } from "@colibri/core";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import { KnownAssetRepository } from "@/persistence/drizzle/repository/known-asset.repository.ts";
import { queryChannelState } from "@/core/service/channel/channel-state.service.ts";
import { requireCouncilId, requireCouncilOwnership } from "./helpers.ts";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import type { Logger } from "@/utils/logger/index.ts";

const metadataRepo = new CouncilMetadataRepository(drizzleClient);

const channelRepo = new CouncilChannelRepository(drizzleClient);
const knownAssetRepo = new KnownAssetRepository(drizzleClient);

function formatChannel(
  ch: {
    id: string;
    channelContractId: string;
    assetCode: string;
    assetContractId: string | null;
    label: string | null;
    totalDeposited: bigint | null;
    totalWithdrawn: bigint | null;
    utxoCount: bigint | null;
    lastSyncedAt: Date | null;
  },
) {
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

export function handleListChannels(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("listChannels");

  return async (ctx) => {
    log.info("listChannels");
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
      log.error(error, "failed to list channels");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to retrieve channels" };
    }
  };
}

export function handleAddChannel(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("addChannel");

  return async (ctx) => {
    log.info("addChannel");
    try {
      const councilId = requireCouncilId(ctx);
      if (!councilId) return;
      if (!await requireCouncilOwnership(ctx, councilId, metadataRepo)) return;
      log.debug("councilId", councilId);

      const body = await ctx.request.body.json();
      const {
        channelContractId,
        assetCode,
        assetContractId,
        issuerAddress,
        label,
      } = body;

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
        ctx.response.body = {
          message: "assetCode must be 1-12 alphanumeric characters",
        };
        return;
      }

      if (
        assetContractId && typeof assetContractId === "string" &&
        !StrKey.isValidContractId(assetContractId)
      ) {
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

      const existing = await channelRepo.findByContractId(
        councilId,
        channelContractId,
      );
      if (existing) {
        ctx.response.status = Status.Conflict;
        ctx.response.body = {
          message: "Channel with this contract ID already exists",
        };
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
        await knownAssetRepo.upsert(
          assetCode.trim(),
          (issuerAddress || "").trim(),
        );
      } catch { /* best effort */ }

      log.debug("channelContractId", channelContractId);
      log.debug("assetCode", assetCode);
      log.event("channel added");

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
        log.error(error, "failed to add channel");
        ctx.response.status = Status.InternalServerError;
        ctx.response.body = { message: "Failed to add channel" };
      }
    }
  };
}

type RouteParams = { id?: string };

export function handleGetChannel(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getChannel");

  return async (ctx) => {
    log.info("getChannel");
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

      if (
        !await requireCouncilOwnership(ctx, channel.councilId, metadataRepo)
      ) {
        return;
      }

      try {
        const onChainState = await queryChannelState(
          channel.channelContractId,
          {
            log,
          },
        );

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
      log.error(error, "failed to get channel");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to retrieve channel" };
    }
  };
}

export function handleRemoveChannel(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("removeChannel");

  return async (ctx) => {
    log.info("removeChannel");
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

      if (
        !await requireCouncilOwnership(ctx, channel.councilId, metadataRepo)
      ) {
        return;
      }

      await channelRepo.update(id, { deletedAt: new Date() });

      log.debug("id", id);
      log.debug("channelContractId", channel.channelContractId);
      log.event("channel disabled");

      ctx.response.status = Status.OK;
      ctx.response.body = { message: "Channel disabled" };
    } catch (error) {
      log.error(error, "failed to disable channel");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to disable channel" };
    }
  };
}

export function handleEnableChannel(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("enableChannel");

  return async (ctx) => {
    log.info("enableChannel");
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

      if (
        !await requireCouncilOwnership(ctx, channel.councilId, metadataRepo)
      ) {
        return;
      }

      await channelRepo.restore(id);

      log.debug("id", id);
      log.debug("channelContractId", channel.channelContractId);
      log.event("channel re-enabled");

      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Channel re-enabled",
        data: formatChannel({ ...channel, deletedAt: null } as typeof channel),
      };
    } catch (error) {
      log.error(error, "failed to re-enable channel");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to re-enable channel" };
    }
  };
}

export function handleListDisabledChannels(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("listDisabledChannels");

  return async (ctx) => {
    log.info("listDisabledChannels");
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
      log.error(error, "failed to list disabled channels");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to retrieve disabled channels" };
    }
  };
}
