import { Router, type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import { CouncilJurisdictionRepository } from "@/persistence/drizzle/repository/council-jurisdiction.repository.ts";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import { CouncilProviderRepository } from "@/persistence/drizzle/repository/council-provider.repository.ts";
import { lowRateLimitMiddleware } from "@/http/middleware/rate-limit/index.ts";
import { postJoinRequestHandler } from "@/http/v1/public/join-request.ts";
import { KnownAssetRepository } from "@/persistence/drizzle/repository/known-asset.repository.ts";
import { LOG } from "@/config/logger.ts";

const metadataRepo = new CouncilMetadataRepository(drizzleClient);
const jurisdictionRepo = new CouncilJurisdictionRepository(drizzleClient);
const channelRepo = new CouncilChannelRepository(drizzleClient);
const providerRepo = new CouncilProviderRepository(drizzleClient);

/**
 * GET /public/council
 * Read-only council summary for the network dashboard.
 * No auth required.
 */
const getCouncilSummary = async (ctx: Context) => {
  try {
    const [metadata, jurisdictions, channels, providers] = await Promise.all([
      metadataRepo.getConfig(),
      jurisdictionRepo.listAll(),
      channelRepo.listAll(),
      providerRepo.listActive(),
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
              channelAuthId: metadata.channelAuthId,
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
          label: ch.label,
        })),
        providers: providers.map((p) => ({
          publicKey: p.publicKey,
          label: p.label,
        })),
      },
    };
  } catch (error) {
    LOG.error("Failed to get council summary", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve council summary" };
  }
};

/**
 * GET /public/providers
 * Lists active providers. No auth required.
 */
const getPublicProviders = async (ctx: Context) => {
  try {
    const providers = await providerRepo.listActive();

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
 * GET /public/channels
 * Lists channels. No auth required.
 */
const getPublicChannels = async (ctx: Context) => {
  try {
    const channels = await channelRepo.listAll();

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

const publicRouter = new Router();

publicRouter.get("/public/council", getCouncilSummary);
publicRouter.get("/public/providers", getPublicProviders);
publicRouter.get("/public/channels", getPublicChannels);
publicRouter.get("/public/known-assets", getKnownAssets);
publicRouter.post("/public/provider/join-request", lowRateLimitMiddleware, postJoinRequestHandler);

export default publicRouter;
