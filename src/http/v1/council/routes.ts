import { Router } from "@oak/oak";
import { jwtMiddleware } from "@/http/middleware/auth/index.ts";
import { requireAdminMiddleware } from "@/http/middleware/auth/require-admin.ts";
import { lowRateLimitMiddleware } from "@/http/middleware/rate-limit/index.ts";
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
councilRouter.get("/council/list", jwtMiddleware, requireAdminMiddleware, listCouncilsHandler);
councilRouter.get("/council/metadata", jwtMiddleware, requireAdminMiddleware, getMetadataHandler);
councilRouter.put("/council/metadata", jwtMiddleware, requireAdminMiddleware, putMetadataHandler);
councilRouter.delete("/council/metadata", jwtMiddleware, requireAdminMiddleware, deleteMetadataHandler);

// Jurisdictions (admin-only)
councilRouter.get("/council/jurisdictions", jwtMiddleware, requireAdminMiddleware, listJurisdictionsHandler);
councilRouter.post("/council/jurisdictions", jwtMiddleware, requireAdminMiddleware, addJurisdictionHandler);
councilRouter.delete("/council/jurisdictions/:code", jwtMiddleware, requireAdminMiddleware, removeJurisdictionHandler);

// Channels (admin-only) — static routes before parameterized
councilRouter.get("/council/channels", jwtMiddleware, requireAdminMiddleware, listChannelsHandler);
councilRouter.post("/council/channels", jwtMiddleware, requireAdminMiddleware, addChannelHandler);
councilRouter.get("/council/channels/disabled", jwtMiddleware, requireAdminMiddleware, listDisabledChannelsHandler);
councilRouter.get("/council/channels/:id", jwtMiddleware, requireAdminMiddleware, getChannelHandler);
councilRouter.delete("/council/channels/:id", jwtMiddleware, requireAdminMiddleware, removeChannelHandler);
councilRouter.post("/council/channels/:id/enable", jwtMiddleware, requireAdminMiddleware, enableChannelHandler);

// Join requests (admin-only)
councilRouter.get("/council/provider-requests", jwtMiddleware, requireAdminMiddleware, listJoinRequestsHandler);
councilRouter.post("/council/provider-requests/:id/approve", jwtMiddleware, requireAdminMiddleware, approveJoinRequestHandler);
councilRouter.post("/council/provider-requests/:id/reject", jwtMiddleware, requireAdminMiddleware, rejectJoinRequestHandler);

// Providers (admin-only)
councilRouter.get("/council/providers", jwtMiddleware, requireAdminMiddleware, listProvidersHandler);
councilRouter.get("/council/providers/:id", jwtMiddleware, requireAdminMiddleware, getProviderHandler);
councilRouter.put("/council/providers/:id", jwtMiddleware, requireAdminMiddleware, updateProviderHandler);

// Signing API (provider JWT — validated internally, rate-limited)
councilRouter.post("/council/sign/register", jwtMiddleware, lowRateLimitMiddleware, postRegisterUserHandler);
councilRouter.post("/council/sign/keys", jwtMiddleware, lowRateLimitMiddleware, postGetKeysHandler);
councilRouter.post("/council/sign/spend", jwtMiddleware, lowRateLimitMiddleware, postSignSpendHandler);

// Escrow (provider JWT for create/lookup, admin for release)
councilRouter.get("/council/recipient/:address/utxos", jwtMiddleware, getRecipientUtxosHandler);
councilRouter.post("/council/escrow", jwtMiddleware, postEscrowHandler);
councilRouter.get("/council/escrow/:address", jwtMiddleware, getEscrowSummaryHandler);
councilRouter.post("/council/escrow/:address/release", jwtMiddleware, requireAdminMiddleware, postEscrowReleaseHandler);

export default councilRouter;
