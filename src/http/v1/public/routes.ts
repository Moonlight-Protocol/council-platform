import { Router, type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import { CouncilJurisdictionRepository } from "@/persistence/drizzle/repository/council-jurisdiction.repository.ts";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import { CouncilProviderRepository } from "@/persistence/drizzle/repository/council-provider.repository.ts";

import { createPostJoinRequestHandler } from "@/http/v1/public/join-request.ts";
import { ProviderJoinRequestRepository } from "@/persistence/drizzle/repository/provider-join-request.repository.ts";
import { KnownAssetRepository } from "@/persistence/drizzle/repository/known-asset.repository.ts";
import { LOG } from "@/config/logger.ts";

const metadataRepo = new CouncilMetadataRepository(drizzleClient);
const jurisdictionRepo = new CouncilJurisdictionRepository(drizzleClient);
const channelRepo = new CouncilChannelRepository(drizzleClient);
const providerRepo = new CouncilProviderRepository(drizzleClient);

function getCouncilId(ctx: Context): string | null {
  return ctx.request.url.searchParams.get("councilId");
}

/**
 * GET /public/council?councilId=...
 * Read-only council summary.
 * No auth required.
 */
const getCouncilSummary = async (ctx: Context) => {
  try {
    const councilId = getCouncilId(ctx);
    if (!councilId) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "councilId query parameter is required" };
      return;
    }
    await returnCouncilSummary(ctx, councilId);
  } catch (error) {
    LOG.error("Failed to get council summary", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve council summary" };
  }
};

async function returnCouncilSummary(ctx: Context, councilId: string) {
  const [metadata, jurisdictions, channels, providers] = await Promise.all([
    metadataRepo.getById(councilId),
    jurisdictionRepo.listAll(councilId),
    channelRepo.listAll(councilId),
    providerRepo.listActive(councilId),
  ]);

  ctx.response.status = Status.OK;
  ctx.response.body = {
    message: "Council summary",
    data: {
      council: metadata
        ? {
            name: metadata.name,
            description: metadata.description,
            contactEmail: metadata.contactEmail,
            channelAuthId: metadata.id,
            councilPublicKey: metadata.councilPublicKey,
          }
        : null,
      jurisdictions: jurisdictions.map((j) => ({
        countryCode: j.countryCode,
        label: j.label,
      })),
      channels: channels.map((ch) => ({
        channelContractId: ch.channelContractId,
        assetCode: ch.assetCode,
        assetContractId: ch.assetContractId,
        label: ch.label,
      })),
      providers: providers.map((p) => ({
        publicKey: p.publicKey,
        label: p.label,
        providerUrl: p.providerUrl,
      })),
    },
  };
}

/**
 * GET /public/councils
 * Lists every council with the same summary shape as GET /public/council.
 * No auth required. Used by the public network dashboard.
 *
 * Note: aggregation is N+1 on the council count. Acceptable while the
 * registered count is small; revisit if it grows.
 */
const listAllCouncils = async (ctx: Context) => {
  try {
    const all = await metadataRepo.listAll();
    const councils = await Promise.all(
      all.map(async (m) => {
        const [jurisdictions, channels, providers] = await Promise.all([
          jurisdictionRepo.listAll(m.id),
          channelRepo.listAll(m.id),
          providerRepo.listActive(m.id),
        ]);
        return {
          council: {
            name: m.name,
            description: m.description,
            contactEmail: m.contactEmail,
            channelAuthId: m.id,
            councilPublicKey: m.councilPublicKey,
          },
          jurisdictions: jurisdictions.map((j) => ({
            countryCode: j.countryCode,
            label: j.label,
          })),
          channels: channels.map((ch) => ({
            channelContractId: ch.channelContractId,
            assetCode: ch.assetCode,
            assetContractId: ch.assetContractId,
            label: ch.label,
          })),
          providers: providers.map((p) => ({
            publicKey: p.publicKey,
            label: p.label,
            providerUrl: p.providerUrl,
          })),
        };
      }),
    );

    ctx.response.status = Status.OK;
    ctx.response.body = { message: "Councils retrieved", data: councils };
  } catch (error) {
    LOG.error("Failed to list councils", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve councils" };
  }
};

/**
 * GET /public/providers?councilId=...
 * Lists active providers. No auth required.
 */
const getPublicProviders = async (ctx: Context) => {
  try {
    const councilId = getCouncilId(ctx);
    if (!councilId) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "councilId query parameter is required" };
      return;
    }
    const providers = await providerRepo.listActive(councilId);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Providers retrieved",
      data: providers.map((p) => ({
        publicKey: p.publicKey,
        label: p.label,
      })),
    };
  } catch (error) {
    LOG.error("Failed to get public providers", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve providers" };
  }
};

/**
 * GET /public/channels?councilId=...
 * Lists channels. No auth required.
 */
const getPublicChannels = async (ctx: Context) => {
  try {
    const councilId = getCouncilId(ctx);
    if (!councilId) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "councilId query parameter is required" };
      return;
    }
    const channels = await channelRepo.listAll(councilId);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Channels retrieved",
      data: channels.map((ch) => ({
        channelContractId: ch.channelContractId,
        assetCode: ch.assetCode,
        assetContractId: ch.assetContractId,
        label: ch.label,
      })),
    };
  } catch (error) {
    LOG.error("Failed to get public channels", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve channels" };
  }
};

const knownAssetRepo = new KnownAssetRepository(drizzleClient);

/**
 * GET /public/known-assets
 * Lists all assets ever enabled via the UI. Used for import discovery.
 */
const getKnownAssets = async (ctx: Context) => {
  try {
    const assets = await knownAssetRepo.listAll();
    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Known assets retrieved",
      data: assets.map((a) => ({ assetCode: a.assetCode, issuerAddress: a.issuerAddress })),
    };
  } catch (error) {
    LOG.error("Failed to list known assets", { error: error instanceof Error ? error.message : String(error) });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve known assets" };
  }
};

const joinRequestRepo = new ProviderJoinRequestRepository(drizzleClient);

/**
 * GET /public/provider/membership-status?councilId=...&publicKey=...
 * Returns the provider's membership status for a council.
 *   200 = active provider (registered on-chain and in DB)
 *   202 = pending join request
 *   404 = not found (also returned for rejected, to prevent enumeration)
 * No auth required — only returns status, no sensitive data.
 */
const getMembershipStatus = async (ctx: Context) => {
  try {
    const councilId = getCouncilId(ctx);
    const publicKey = ctx.request.url.searchParams.get("publicKey");

    if (!councilId || !publicKey) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "councilId and publicKey query parameters are required" };
      return;
    }

    // Check if active provider (single-row lookup)
    const provider = await providerRepo.findByPublicKey(councilId, publicKey);
    if (provider && provider.status === "ACTIVE") {
      ctx.response.status = 200;
      ctx.response.body = { status: "ACTIVE" };
      return;
    }

    // Check for pending request
    const pending = await joinRequestRepo.findPendingByPublicKey(councilId, publicKey);
    if (pending) {
      ctx.response.status = 202;
      ctx.response.body = { status: "PENDING" };
      return;
    }

    // Return 404 for both rejected and non-existent providers to prevent enumeration
    ctx.response.status = 404;
    ctx.response.body = { status: "NOT_FOUND" };
  } catch (error) {
    LOG.error("Failed to get membership status", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve membership status" };
  }
};

const publicRouter = new Router();

publicRouter.get("/public/provider/membership-status", getMembershipStatus);
publicRouter.get("/public/councils", listAllCouncils);
publicRouter.get("/public/council", getCouncilSummary);
publicRouter.get("/public/providers", getPublicProviders);
publicRouter.get("/public/channels", getPublicChannels);
publicRouter.get("/public/known-assets", getKnownAssets);
publicRouter.post("/public/provider/join-request", createPostJoinRequestHandler(joinRequestRepo));

export default publicRouter;
