import { type Context, Status } from "@oak/oak";
import { StrKey } from "@colibri/core";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import { KnownAssetRepository } from "@/persistence/drizzle/repository/known-asset.repository.ts";
import { queryChannelState } from "@/core/service/channel/channel-state.service.ts";
import { requireCouncilId, requireCouncilOwnership } from "./helpers.ts";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import {
  ChannelPendingAction,
  ChannelStatus,
} from "@/persistence/drizzle/entity/council-channel.entity.ts";
import * as E from "@/http/v1/error.ts";
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
    status: string;
    pendingAction: string | null;
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
    // Confirmed on-chain lifecycle status + optimistic pending marker.
    status: ch.status,
    pendingAction: ch.pendingAction,
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
    const councilId = requireCouncilId(ctx);
    await requireCouncilOwnership(ctx, councilId, metadataRepo);

    const channels = await channelRepo.listAll(councilId);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Channels retrieved",
      data: channels.map(formatChannel),
    };
  };
}

export function handleAddChannel(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("addChannel");

  return async (ctx) => {
    log.info("addChannel");
    const councilId = requireCouncilId(ctx);
    await requireCouncilOwnership(ctx, councilId, metadataRepo);
    log.debug("councilId", councilId);

    let body;
    try {
      body = await ctx.request.body.json();
    } catch (error) {
      throw new E.INVALID_REQUEST_BODY(error);
    }
    const {
      channelContractId,
      assetCode,
      assetContractId,
      issuerAddress,
      label,
    } = body;

    if (!channelContractId || typeof channelContractId !== "string") {
      throw new E.VALIDATION_FAILED("channelContractId is required");
    }

    if (!StrKey.isValidContractId(channelContractId)) {
      throw new E.VALIDATION_FAILED("Invalid Soroban contract ID format");
    }

    if (!assetCode || typeof assetCode !== "string") {
      throw new E.VALIDATION_FAILED("assetCode is required");
    }

    if (assetCode.length > 12 || !/^[a-zA-Z0-9]+$/.test(assetCode)) {
      throw new E.VALIDATION_FAILED(
        "assetCode must be 1-12 alphanumeric characters",
      );
    }

    if (
      assetContractId && typeof assetContractId === "string" &&
      !StrKey.isValidContractId(assetContractId)
    ) {
      throw new E.VALIDATION_FAILED("Invalid asset contract ID format");
    }

    if (label && typeof label !== "string") {
      throw new E.VALIDATION_FAILED("label must be a string");
    }
    if (label && label.length > 200) {
      throw new E.VALIDATION_FAILED("label must be at most 200 characters");
    }

    const existing = await channelRepo.findByContractId(
      councilId,
      channelContractId,
    );
    if (existing) {
      throw new E.RESOURCE_CONFLICT(
        "Channel with this contract ID already exists",
      );
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
  };
}

type RouteParams = { id?: string };

export function handleGetChannel(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getChannel");

  return async (ctx) => {
    log.info("getChannel");
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const id = params?.id;

    if (!id) {
      throw new E.RESOURCE_ID_REQUIRED("Channel ID");
    }

    const channel = await channelRepo.findById(id);
    if (!channel) {
      throw new E.RESOURCE_NOT_FOUND("Channel not found");
    }

    await requireCouncilOwnership(ctx, channel.councilId, metadataRepo);

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
  };
}

export function handleRemoveChannel(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("removeChannel");

  return async (ctx) => {
    log.info("removeChannel");
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const id = params?.id;

    if (!id) {
      throw new E.RESOURCE_ID_REQUIRED("Channel ID");
    }

    const channel = await channelRepo.findById(id);
    if (!channel) {
      throw new E.RESOURCE_NOT_FOUND("Channel not found");
    }

    await requireCouncilOwnership(ctx, channel.councilId, metadataRepo);

    // Record the council's intent ONLY. The authoritative `status` flip to
    // "disabled" is written by the event-watcher when the quorum-authorized
    // disable_channel call is confirmed on-chain — never here (no optimistic
    // authoritative write). The on-chain quorum tx is signed client-side.
    const updated = await channelRepo.setPendingAction(
      id,
      ChannelPendingAction.DISABLE,
    );

    log.debug("id", id);
    log.debug("channelContractId", channel.channelContractId);
    log.event("channel disable requested (pending on-chain confirmation)");

    ctx.response.status = Status.Accepted;
    ctx.response.body = {
      message: "Channel disable requested; pending on-chain confirmation",
      data: formatChannel(updated),
    };
  };
}

export function handleEnableChannel(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("enableChannel");

  return async (ctx) => {
    log.info("enableChannel");
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const id = params?.id;

    if (!id) {
      throw new E.RESOURCE_ID_REQUIRED("Channel ID");
    }

    const channel = await channelRepo.findByIdIncludeDeleted(id);
    if (!channel || channel.status !== ChannelStatus.DISABLED) {
      throw new E.RESOURCE_NOT_FOUND("Disabled channel not found");
    }

    await requireCouncilOwnership(ctx, channel.councilId, metadataRepo);

    // Intent only — the watcher flips `status` back to "enabled" once the
    // quorum-authorized enable_channel call is confirmed on-chain. Re-enable
    // reuses the same on-chain enable action.
    const updated = await channelRepo.setPendingAction(
      id,
      ChannelPendingAction.ENABLE,
    );

    log.debug("id", id);
    log.debug("channelContractId", channel.channelContractId);
    log.event("channel re-enable requested (pending on-chain confirmation)");

    ctx.response.status = Status.Accepted;
    ctx.response.body = {
      message: "Channel re-enable requested; pending on-chain confirmation",
      data: formatChannel(updated),
    };
  };
}

export function handleListDisabledChannels(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("listDisabledChannels");

  return async (ctx) => {
    log.info("listDisabledChannels");
    const councilId = requireCouncilId(ctx);
    await requireCouncilOwnership(ctx, councilId, metadataRepo);

    const channels = await channelRepo.listDisabled(councilId);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Disabled channels retrieved",
      data: channels.map(formatChannel),
    };
  };
}
