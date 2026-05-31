import { type Context, Router, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import { CouncilJurisdictionRepository } from "@/persistence/drizzle/repository/council-jurisdiction.repository.ts";
import { CouncilChannelRepository } from "@/persistence/drizzle/repository/council-channel.repository.ts";
import { CouncilProviderRepository } from "@/persistence/drizzle/repository/council-provider.repository.ts";

import { createPostJoinRequestHandler } from "@/http/v1/public/join-request.ts";
import { ProviderJoinRequestRepository } from "@/persistence/drizzle/repository/provider-join-request.repository.ts";
import { KnownAssetRepository } from "@/persistence/drizzle/repository/known-asset.repository.ts";
import type { Logger } from "@/utils/logger/index.ts";

const metadataRepo = new CouncilMetadataRepository(drizzleClient);
const jurisdictionRepo = new CouncilJurisdictionRepository(drizzleClient);
const channelRepo = new CouncilChannelRepository(drizzleClient);
const providerRepo = new CouncilProviderRepository(drizzleClient);

function getCouncilId(ctx: Context): string | null {
  return ctx.request.url.searchParams.get("councilId");
}

async function returnCouncilSummary(
  ctx: Context,
  councilId: string,
  deps: { log: Logger },
) {
  const log = deps.log.scope("returnCouncilSummary");
  log.info("returnCouncilSummary");
  log.debug("councilId", councilId);

  log.event("loading council metadata + jurisdictions + channels + providers");
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
      providers: providers.map((p) => {
        let parsedJurisdictions: string[] | null = null;
        if (p.jurisdictions) {
          try {
            parsedJurisdictions = JSON.parse(p.jurisdictions);
          } catch {
            parsedJurisdictions = null;
          }
        }
        return {
          publicKey: p.publicKey,
          label: p.label,
          providerUrl: p.providerUrl,
          jurisdictions: parsedJurisdictions,
        };
      }),
    },
  };
}

const knownAssetRepo = new KnownAssetRepository(drizzleClient);
const joinRequestRepo = new ProviderJoinRequestRepository(drizzleClient);

export function buildPublicRouter(deps: { log: Logger }): Router {
  const log = deps.log.scope("public");

  const handleGetCouncilSummary = async (ctx: Context) => {
    try {
      const councilId = getCouncilId(ctx);
      if (!councilId) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "councilId query parameter is required",
        };
        return;
      }
      await returnCouncilSummary(ctx, councilId, deps);
    } catch (error) {
      log.error(error, "failed to get council summary");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to retrieve council summary" };
    }
  };

  const handleListAllCouncils = async (ctx: Context) => {
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
            providers: providers.map((p) => {
              let parsedJurisdictions: string[] | null = null;
              if (p.jurisdictions) {
                try {
                  parsedJurisdictions = JSON.parse(p.jurisdictions);
                } catch {
                  parsedJurisdictions = null;
                }
              }
              return {
                publicKey: p.publicKey,
                label: p.label,
                providerUrl: p.providerUrl,
                jurisdictions: parsedJurisdictions,
              };
            }),
          };
        }),
      );

      ctx.response.status = Status.OK;
      ctx.response.body = { message: "Councils retrieved", data: councils };
    } catch (error) {
      log.error(error, "failed to list councils");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to retrieve councils" };
    }
  };

  const handleGetPublicProviders = async (ctx: Context) => {
    try {
      const councilId = getCouncilId(ctx);
      if (!councilId) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "councilId query parameter is required",
        };
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
      log.error(error, "failed to get public providers");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to retrieve providers" };
    }
  };

  const handleGetPublicChannels = async (ctx: Context) => {
    try {
      const councilId = getCouncilId(ctx);
      if (!councilId) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "councilId query parameter is required",
        };
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
      log.error(error, "failed to get public channels");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to retrieve channels" };
    }
  };

  const handleGetKnownAssets = async (ctx: Context) => {
    try {
      const assets = await knownAssetRepo.listAll();
      ctx.response.status = Status.OK;
      ctx.response.body = {
        message: "Known assets retrieved",
        data: assets.map((a) => ({
          assetCode: a.assetCode,
          issuerAddress: a.issuerAddress,
        })),
      };
    } catch (error) {
      log.error(error, "failed to list known assets");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to retrieve known assets" };
    }
  };

  const handleGetMembershipStatus = async (ctx: Context) => {
    try {
      const councilId = getCouncilId(ctx);
      const publicKey = ctx.request.url.searchParams.get("publicKey");

      if (!councilId || !publicKey) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message: "councilId and publicKey query parameters are required",
        };
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
      const pending = await joinRequestRepo.findPendingByPublicKey(
        councilId,
        publicKey,
      );
      if (pending) {
        ctx.response.status = 202;
        ctx.response.body = { status: "PENDING" };
        return;
      }

      // Return 404 for both rejected and non-existent providers to prevent enumeration
      ctx.response.status = 404;
      ctx.response.body = { status: "NOT_FOUND" };
    } catch (error) {
      log.error(error, "failed to get membership status");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to retrieve membership status" };
    }
  };

  const publicRouter = new Router();

  publicRouter.get(
    "/public/provider/membership-status",
    handleGetMembershipStatus,
  );
  publicRouter.get("/public/councils", handleListAllCouncils);
  publicRouter.get("/public/council", handleGetCouncilSummary);
  publicRouter.get("/public/providers", handleGetPublicProviders);
  publicRouter.get("/public/channels", handleGetPublicChannels);
  publicRouter.get("/public/known-assets", handleGetKnownAssets);
  publicRouter.post(
    "/public/provider/join-request",
    createPostJoinRequestHandler(joinRequestRepo, { log }),
  );

  return publicRouter;
}
