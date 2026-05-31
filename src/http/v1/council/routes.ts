import { Router } from "@oak/oak";
import type { Logger } from "@/utils/logger/index.ts";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";
import {
  handleDeleteMetadata,
  handleGetMetadata,
  handleListCouncils,
  handlePutMetadata,
} from "@/http/v1/council/metadata.ts";
import {
  handleAddJurisdiction,
  handleListJurisdictions,
  handleRemoveJurisdiction,
} from "@/http/v1/council/jurisdictions.ts";
import {
  handleAddChannel,
  handleEnableChannel,
  handleGetChannel,
  handleListChannels,
  handleListDisabledChannels,
  handleRemoveChannel,
} from "@/http/v1/council/channels.ts";
import {
  handleGetProvider,
  handleListProviders,
  handleUpdateProvider,
} from "@/http/v1/council/providers.ts";
import {
  handlePostGetKeys,
  handlePostRegisterUser,
  handlePostSignSpend,
} from "@/http/v1/council/sign.ts";
import {
  handleGetEscrowSummary,
  handleGetRecipientUtxos,
  handlePostEscrow,
  handlePostEscrowRelease,
} from "@/http/v1/council/escrow.ts";
import {
  handleApproveJoinRequest,
  handleListJoinRequests,
  handleRejectJoinRequest,
} from "@/http/v1/council/join-requests.ts";

export function buildCouncilRouter(deps: { log: Logger }): Router {
  const councilRouter = new Router();

  // Councils
  councilRouter.get(
    "/council/list",
    jwtMiddleware(deps),
    handleListCouncils(deps),
  );
  councilRouter.get(
    "/council/metadata",
    jwtMiddleware(deps),
    handleGetMetadata(deps),
  );
  councilRouter.put(
    "/council/metadata",
    jwtMiddleware(deps),
    handlePutMetadata(deps),
  );
  councilRouter.delete(
    "/council/metadata",
    jwtMiddleware(deps),
    handleDeleteMetadata(deps),
  );

  // Jurisdictions (admin-only)
  councilRouter.get(
    "/council/jurisdictions",
    jwtMiddleware(deps),
    handleListJurisdictions(deps),
  );
  councilRouter.post(
    "/council/jurisdictions",
    jwtMiddleware(deps),
    handleAddJurisdiction(deps),
  );
  councilRouter.delete(
    "/council/jurisdictions/:code",
    jwtMiddleware(deps),
    handleRemoveJurisdiction(deps),
  );

  // Channels (admin-only) — static routes before parameterized
  councilRouter.get(
    "/council/channels",
    jwtMiddleware(deps),
    handleListChannels(deps),
  );
  councilRouter.post(
    "/council/channels",
    jwtMiddleware(deps),
    handleAddChannel(deps),
  );
  councilRouter.get(
    "/council/channels/disabled",
    jwtMiddleware(deps),
    handleListDisabledChannels(deps),
  );
  councilRouter.get(
    "/council/channels/:id",
    jwtMiddleware(deps),
    handleGetChannel(deps),
  );
  councilRouter.delete(
    "/council/channels/:id",
    jwtMiddleware(deps),
    handleRemoveChannel(deps),
  );
  councilRouter.post(
    "/council/channels/:id/enable",
    jwtMiddleware(deps),
    handleEnableChannel(deps),
  );

  // Join requests (admin-only)
  councilRouter.get(
    "/council/provider-requests",
    jwtMiddleware(deps),
    handleListJoinRequests(deps),
  );
  councilRouter.post(
    "/council/provider-requests/:id/approve",
    jwtMiddleware(deps),
    handleApproveJoinRequest(deps),
  );
  councilRouter.post(
    "/council/provider-requests/:id/reject",
    jwtMiddleware(deps),
    handleRejectJoinRequest(deps),
  );

  // Providers (admin-only)
  councilRouter.get(
    "/council/providers",
    jwtMiddleware(deps),
    handleListProviders(deps),
  );
  councilRouter.get(
    "/council/providers/:id",
    jwtMiddleware(deps),
    handleGetProvider(deps),
  );
  councilRouter.put(
    "/council/providers/:id",
    jwtMiddleware(deps),
    handleUpdateProvider(deps),
  );

  // Signing API (provider JWT — validated internally)
  councilRouter.post(
    "/council/sign/register",
    jwtMiddleware(deps),
    handlePostRegisterUser(deps),
  );
  councilRouter.post(
    "/council/sign/keys",
    jwtMiddleware(deps),
    handlePostGetKeys(deps),
  );
  councilRouter.post(
    "/council/sign/spend",
    jwtMiddleware(deps),
    handlePostSignSpend(deps),
  );

  // Escrow (provider JWT for create/lookup, admin for release)
  councilRouter.get(
    "/council/recipient/:address/utxos",
    jwtMiddleware(deps),
    handleGetRecipientUtxos(deps),
  );
  councilRouter.post(
    "/council/escrow",
    jwtMiddleware(deps),
    handlePostEscrow(deps),
  );
  councilRouter.get(
    "/council/escrow/:address",
    jwtMiddleware(deps),
    handleGetEscrowSummary(deps),
  );
  councilRouter.post(
    "/council/escrow/:address/release",
    jwtMiddleware(deps),
    handlePostEscrowRelease(deps),
  );

  return councilRouter;
}
