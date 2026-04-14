import { Router } from "@oak/oak";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";
import { getMetadataHandler, listCouncilsHandler, putMetadataHandler, deleteMetadataHandler } from "@/http/v1/council/metadata.ts";
import {
  listJurisdictionsHandler,
  addJurisdictionHandler,
  removeJurisdictionHandler,
} from "@/http/v1/council/jurisdictions.ts";
import {
  listChannelsHandler,
  addChannelHandler,
  getChannelHandler,
  removeChannelHandler,
  enableChannelHandler,
  listDisabledChannelsHandler,
} from "@/http/v1/council/channels.ts";
import {
  listProvidersHandler,
  getProviderHandler,
  updateProviderHandler,
} from "@/http/v1/council/providers.ts";
import {
  postRegisterUserHandler,
  postGetKeysHandler,
  postSignSpendHandler,
} from "@/http/v1/council/sign.ts";
import {
  getRecipientUtxosHandler,
  postEscrowHandler,
  getEscrowSummaryHandler,
  postEscrowReleaseHandler,
} from "@/http/v1/council/escrow.ts";
import {
  listJoinRequestsHandler,
  approveJoinRequestHandler,
  rejectJoinRequestHandler,
} from "@/http/v1/council/join-requests.ts";

const councilRouter = new Router();

// Councils
councilRouter.get("/council/list", jwtMiddleware,listCouncilsHandler);
councilRouter.get("/council/metadata", jwtMiddleware,getMetadataHandler);
councilRouter.put("/council/metadata", jwtMiddleware,putMetadataHandler);
councilRouter.delete("/council/metadata", jwtMiddleware,deleteMetadataHandler);

// Jurisdictions (admin-only)
councilRouter.get("/council/jurisdictions", jwtMiddleware,listJurisdictionsHandler);
councilRouter.post("/council/jurisdictions", jwtMiddleware,addJurisdictionHandler);
councilRouter.delete("/council/jurisdictions/:code", jwtMiddleware,removeJurisdictionHandler);

// Channels (admin-only) — static routes before parameterized
councilRouter.get("/council/channels", jwtMiddleware,listChannelsHandler);
councilRouter.post("/council/channels", jwtMiddleware,addChannelHandler);
councilRouter.get("/council/channels/disabled", jwtMiddleware,listDisabledChannelsHandler);
councilRouter.get("/council/channels/:id", jwtMiddleware,getChannelHandler);
councilRouter.delete("/council/channels/:id", jwtMiddleware,removeChannelHandler);
councilRouter.post("/council/channels/:id/enable", jwtMiddleware,enableChannelHandler);

// Join requests (admin-only)
councilRouter.get("/council/provider-requests", jwtMiddleware,listJoinRequestsHandler);
councilRouter.post("/council/provider-requests/:id/approve", jwtMiddleware,approveJoinRequestHandler);
councilRouter.post("/council/provider-requests/:id/reject", jwtMiddleware,rejectJoinRequestHandler);

// Providers (admin-only)
councilRouter.get("/council/providers", jwtMiddleware,listProvidersHandler);
councilRouter.get("/council/providers/:id", jwtMiddleware,getProviderHandler);
councilRouter.put("/council/providers/:id", jwtMiddleware,updateProviderHandler);

// Signing API (provider JWT — validated internally, validated internally)

// Escrow (provider JWT for create/lookup, admin for release)
councilRouter.get("/council/recipient/:address/utxos", jwtMiddleware, getRecipientUtxosHandler);
councilRouter.post("/council/escrow", jwtMiddleware, postEscrowHandler);
councilRouter.get("/council/escrow/:address", jwtMiddleware, getEscrowSummaryHandler);
councilRouter.post("/council/escrow/:address/release", jwtMiddleware,postEscrowReleaseHandler);

export default councilRouter;
