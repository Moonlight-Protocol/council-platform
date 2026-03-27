import { type Context, Status } from "@oak/oak";
import { Keypair, TransactionBuilder, Contract, Address, nativeToScVal } from "stellar-sdk";
import { Server, assembleTransaction } from "stellar-sdk/rpc";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { ProviderJoinRequestRepository } from "@/persistence/drizzle/repository/provider-join-request.repository.ts";
import { CouncilProviderRepository } from "@/persistence/drizzle/repository/council-provider.repository.ts";
import { JoinRequestStatus } from "@/persistence/drizzle/entity/provider-join-request.entity.ts";
import { ProviderStatus } from "@/persistence/drizzle/entity/council-provider.entity.ts";
import { CHANNEL_AUTH_ID, COUNCIL_SK, NETWORK_CONFIG, NETWORK } from "@/config/env.ts";
import { LOG } from "@/config/logger.ts";

const joinRequestRepo = new ProviderJoinRequestRepository(drizzleClient);
const providerRepo = new CouncilProviderRepository(drizzleClient);

function formatJoinRequest(r: {
  id: string;
  publicKey: string;
  label: string | null;
  contactEmail: string | null;
  status: string;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewedBy: string | null;
}) {
  return {
    id: r.id,
    publicKey: r.publicKey,
    label: r.label,
    contactEmail: r.contactEmail,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    reviewedBy: r.reviewedBy,
  };
}

/**
 * GET /council/provider-requests
 * Lists join requests. Optional ?status= filter.
 */
export const listJoinRequestsHandler = async (ctx: Context) => {
  try {
    const statusFilter = ctx.request.url.searchParams.get("status");

    let requests;
    if (statusFilter === "PENDING") {
      requests = await joinRequestRepo.listPending();
    } else {
      requests = await joinRequestRepo.listAll();
    }

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Join requests retrieved",
      data: requests.map(formatJoinRequest),
    };
  } catch (error) {
    LOG.error("Failed to list join requests", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve join requests" };
  }
};

type RouteParams = { id?: string };

/**
 * POST /council/provider-requests/:id/approve
 * Approves a join request: calls add_provider on-chain, creates provider record.
 */
export const approveJoinRequestHandler = async (ctx: Context) => {
  try {
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const id = params?.id;

    if (!id) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Request ID is required" };
      return;
    }

    const request = await joinRequestRepo.findById(id);
    if (!request) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Join request not found" };
      return;
    }

    if (request.status !== JoinRequestStatus.PENDING) {
      ctx.response.status = Status.Conflict;
      ctx.response.body = { message: `Request is already ${request.status}` };
      return;
    }

    // Call add_provider on the Channel Auth contract
    const adminPublicKey = (ctx.state.session as { sub: string }).sub;
    try {
      await callAddProvider(request.publicKey);
    } catch (error) {
      LOG.error("Failed to call add_provider on-chain", {
        error: error instanceof Error ? error.message : String(error),
        providerKey: request.publicKey,
      });
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to add provider on-chain" };
      return;
    }

    // Update request status
    await joinRequestRepo.update(id, {
      status: JoinRequestStatus.APPROVED,
      reviewedAt: new Date(),
      reviewedBy: adminPublicKey,
    });

    // Create provider record (may already exist from event watcher, so handle gracefully)
    const existing = await providerRepo.findByPublicKey(request.publicKey);
    if (!existing) {
      await providerRepo.create({
        id: crypto.randomUUID(),
        publicKey: request.publicKey,
        status: ProviderStatus.ACTIVE,
        label: request.label,
        contactEmail: request.contactEmail,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    LOG.info("Join request approved", { id, providerKey: request.publicKey });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Join request approved",
      data: formatJoinRequest({
        ...request,
        status: JoinRequestStatus.APPROVED,
        reviewedAt: new Date(),
        reviewedBy: adminPublicKey,
      }),
    };
  } catch (error) {
    LOG.error("Failed to approve join request", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to approve join request" };
  }
};

/**
 * POST /council/provider-requests/:id/reject
 * Rejects a join request.
 */
export const rejectJoinRequestHandler = async (ctx: Context) => {
  try {
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const id = params?.id;

    if (!id) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Request ID is required" };
      return;
    }

    const request = await joinRequestRepo.findById(id);
    if (!request) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: "Join request not found" };
      return;
    }

    if (request.status !== JoinRequestStatus.PENDING) {
      ctx.response.status = Status.Conflict;
      ctx.response.body = { message: `Request is already ${request.status}` };
      return;
    }

    const adminPublicKey = (ctx.state.session as { sub: string }).sub;

    await joinRequestRepo.update(id, {
      status: JoinRequestStatus.REJECTED,
      reviewedAt: new Date(),
      reviewedBy: adminPublicKey,
    });

    LOG.info("Join request rejected", { id, providerKey: request.publicKey });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Join request rejected",
      data: formatJoinRequest({
        ...request,
        status: JoinRequestStatus.REJECTED,
        reviewedAt: new Date(),
        reviewedBy: adminPublicKey,
      }),
    };
  } catch (error) {
    LOG.error("Failed to reject join request", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to reject join request" };
  }
};

/**
 * Invoke add_provider on the Channel Auth contract using the council's keypair.
 */
async function callAddProvider(providerPublicKey: string): Promise<void> {
  let networkPassphrase: string;
  switch (NETWORK) {
    case "local":
      networkPassphrase = "Standalone Network ; February 2017";
      break;
    case "testnet":
      networkPassphrase = "Test SDF Network ; September 2015";
      break;
    default:
      networkPassphrase = "Public Global Stellar Network ; September 2015";
      break;
  }

  const rpcUrl = NETWORK_CONFIG.rpcUrl as string;
  const server = new Server(rpcUrl, { allowHttp: true });

  const councilKeypair = Keypair.fromSecret(COUNCIL_SK);
  const sourcePublicKey = councilKeypair.publicKey();

  const account = await server.getAccount(sourcePublicKey);
  const contract = new Contract(CHANNEL_AUTH_ID);

  const providerAddress = nativeToScVal(
    Address.fromString(providerPublicKey),
    { type: "address" },
  );

  const tx = new TransactionBuilder(account, {
    fee: "10000000",
    networkPassphrase,
  })
    .addOperation(contract.call("add_provider", providerAddress))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if ("error" in sim && sim.error) {
    throw new Error(`Simulation failed: ${JSON.stringify(sim.error)}`);
  }

  const prepared = assembleTransaction(tx, sim).build();
  prepared.sign(councilKeypair);

  const result = await server.sendTransaction(prepared);

  // Wait for confirmation
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const status = await server.getTransaction(result.hash);
    if (status.status === "SUCCESS") return;
    if (status.status === "FAILED") {
      throw new Error("Transaction failed on-chain");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Transaction timed out");
}
