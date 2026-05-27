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
  councilRouter.get("/council/list", jwtMiddleware, handleListCouncils(deps));
  councilRouter.get(
    "/council/metadata",
    jwtMiddleware,
    handleGetMetadata(deps),
  );
  councilRouter.put(
    "/council/metadata",
    jwtMiddleware,
    handlePutMetadata(deps),
  );
  councilRouter.delete(
    "/council/metadata",
    jwtMiddleware,
    handleDeleteMetadata(deps),
  );

  // Jurisdictions (admin-only)
  councilRouter.get(
    "/council/jurisdictions",
    jwtMiddleware,
    handleListJurisdictions(deps),
  );
  councilRouter.post(
    "/council/jurisdictions",
    jwtMiddleware,
    handleAddJurisdiction(deps),
  );
  councilRouter.delete(
    "/council/jurisdictions/:code",
    jwtMiddleware,
    handleRemoveJurisdiction(deps),
  );

  // Channels (admin-only) — static routes before parameterized
  councilRouter.get(
    "/council/channels",
    jwtMiddleware,
    handleListChannels(deps),
  );
  councilRouter.post(
    "/council/channels",
    jwtMiddleware,
    handleAddChannel(deps),
  );
  councilRouter.get(
    "/council/channels/disabled",
    jwtMiddleware,
    handleListDisabledChannels(deps),
  );
  councilRouter.get(
    "/council/channels/:id",
    jwtMiddleware,
    handleGetChannel(deps),
  );
  councilRouter.delete(
    "/council/channels/:id",
    jwtMiddleware,
    handleRemoveChannel(deps),
  );
  councilRouter.post(
    "/council/channels/:id/enable",
    jwtMiddleware,
    handleEnableChannel(deps),
  );

  // Join requests (admin-only)
  councilRouter.get(
    "/council/provider-requests",
    jwtMiddleware,
    handleListJoinRequests(deps),
  );
  councilRouter.post(
    "/council/provider-requests/:id/approve",
    jwtMiddleware,
    handleApproveJoinRequest(deps),
  );
  councilRouter.post(
    "/council/provider-requests/:id/reject",
    jwtMiddleware,
    handleRejectJoinRequest(deps),
  );

  // Providers (admin-only)
  councilRouter.get(
    "/council/providers",
    jwtMiddleware,
    handleListProviders(deps),
  );
  councilRouter.get(
    "/council/providers/:id",
    jwtMiddleware,
    handleGetProvider(deps),
  );
  councilRouter.put(
    "/council/providers/:id",
    jwtMiddleware,
    handleUpdateProvider(deps),
  );

  // Signing API (provider JWT — validated internally)
  councilRouter.post(
    "/council/sign/register",
    jwtMiddleware,
    handlePostRegisterUser(deps),
  );
  councilRouter.post(
    "/council/sign/keys",
    jwtMiddleware,
    handlePostGetKeys(deps),
  );
  councilRouter.post(
    "/council/sign/spend",
    jwtMiddleware,
    handlePostSignSpend(deps),
  );

  // Escrow (provider JWT for create/lookup, admin for release)
  councilRouter.get(
    "/council/recipient/:address/utxos",
    jwtMiddleware,
    handleGetRecipientUtxos(deps),
  );
  councilRouter.post("/council/escrow", jwtMiddleware, handlePostEscrow(deps));
  councilRouter.get(
    "/council/escrow/:address",
    jwtMiddleware,
    handleGetEscrowSummary(deps),
  );
  councilRouter.post(
    "/council/escrow/:address/release",
    jwtMiddleware,
    handlePostEscrowRelease(deps),
  );

  return councilRouter;
}
