import { type Context, Status } from "@oak/oak";
import { StrKey } from "@colibri/core";
import {
  createEscrow,
  getEscrowSummary,
  getRecipientUtxos,
  releaseEscrowsForRecipient,
} from "@/core/service/escrow/escrow.service.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import type { Logger } from "@/utils/logger/index.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilProviderRepository } from "@/persistence/drizzle/repository/council-provider.repository.ts";
import * as E from "@/http/v1/error.ts";

const providerRepo = new CouncilProviderRepository(drizzleClient);
const AMOUNT_RE = /^\d+$/;

type RouteParams = { address?: string };

/**
 * GET /council/recipient/:address/utxos
 *
 * PP checks if a recipient has UTXO addresses for a channel.
 * Query param: ?channelContractId=C...&count=1
 */
export function handleGetRecipientUtxos(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getRecipientUtxos");

  return async (ctx) => {
    log.info("getRecipientUtxos");
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const address = params?.address;

    if (!address) {
      throw new E.RESOURCE_ID_REQUIRED("Recipient address");
    }

    const channelContractId = ctx.request.url.searchParams.get(
      "channelContractId",
    );
    if (!channelContractId) {
      throw new E.RESOURCE_ID_REQUIRED("channelContractId query param");
    }

    const councilId = ctx.request.url.searchParams.get("councilId");
    if (!councilId) {
      throw new E.RESOURCE_ID_REQUIRED("councilId query param");
    }

    const count = Number(ctx.request.url.searchParams.get("count") || "1");
    if (!Number.isInteger(count) || count < 1 || count > 300) {
      throw new E.VALIDATION_FAILED("count must be 1-300");
    }

    const result = await getRecipientUtxos(
      councilId,
      address,
      channelContractId,
      count,
      deps,
    );

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: result.registered
        ? "Recipient has UTXO addresses"
        : "Recipient not registered",
      data: result,
    };
  };
}

/**
 * POST /council/escrow
 *
 * PP deposits funds into escrow for a non-KYC'd recipient.
 *
 * Body: {
 *   senderAddress: string,
 *   recipientAddress: string,
 *   amount: string (stroops),
 *   assetCode: string,
 *   channelContractId: string
 * }
 */
export function handlePostEscrow(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("postEscrow");

  return async (ctx) => {
    log.info("postEscrow");
    const session = ctx.state.session as JwtSessionData;

    let body;
    try {
      body = await ctx.request.body.json();
    } catch (error) {
      throw new E.INVALID_REQUEST_BODY(error);
    }
    const {
      councilId,
      senderAddress,
      recipientAddress,
      amount,
      assetCode,
      channelContractId,
    } = body;

    if (
      !councilId || !senderAddress || !recipientAddress || !amount ||
      !assetCode || !channelContractId
    ) {
      throw new E.VALIDATION_FAILED(
        "councilId, senderAddress, recipientAddress, amount, assetCode, and channelContractId are required",
      );
    }

    if (typeof amount !== "string" || !AMOUNT_RE.test(amount)) {
      throw new E.VALIDATION_FAILED(
        "amount must be a positive integer string (stroops)",
      );
    }

    const amountBigInt = BigInt(amount);
    if (amountBigInt <= 0n) {
      throw new E.VALIDATION_FAILED("amount must be positive");
    }

    if (!StrKey.isValidContractId(channelContractId)) {
      throw new E.VALIDATION_FAILED("Invalid channelContractId");
    }

    // Verify the calling provider belongs to this council
    const provider = await providerRepo.findByPublicKey(
      councilId,
      session.sub,
    );
    if (!provider) {
      throw new E.FORBIDDEN("Provider not a member of this council");
    }

    const result = await createEscrow({
      councilId,
      senderAddress,
      recipientAddress,
      amount: amountBigInt,
      assetCode,
      channelContractId,
      submittedByProvider: session.sub,
    }, { log });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Escrow created",
      data: result,
    };
  };
}

/**
 * GET /council/escrow/:address
 *
 * Get pending escrow summary for a recipient.
 * Available to providers (to show users their pending funds).
 */
export function handleGetEscrowSummary(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("getEscrowSummary");

  return async (ctx) => {
    log.info("getEscrowSummary");
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const address = params?.address;

    if (!address) {
      throw new E.RESOURCE_ID_REQUIRED("Recipient address");
    }

    const summary = await getEscrowSummary(address, deps);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Escrow summary retrieved",
      data: {
        pendingCount: summary.pendingCount,
        pendingTotal: summary.pendingTotal.toString(),
        escrows: summary.escrows,
      },
    };
  };
}

/**
 * POST /council/escrow/:address/release
 *
 * Triggers escrow release for a recipient after KYC completion.
 * Admin-only — called when the council confirms KYC.
 *
 * Body: { channelContractId: string }
 */
export function handlePostEscrowRelease(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("postEscrowRelease");

  return async (ctx) => {
    log.info("postEscrowRelease");
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const address = params?.address;

    if (!address) {
      throw new E.RESOURCE_ID_REQUIRED("Recipient address");
    }

    let body;
    try {
      body = await ctx.request.body.json();
    } catch (error) {
      throw new E.INVALID_REQUEST_BODY(error);
    }
    const { channelContractId } = body;

    if (!channelContractId || !StrKey.isValidContractId(channelContractId)) {
      throw new E.VALIDATION_FAILED("Valid channelContractId is required");
    }

    const result = await releaseEscrowsForRecipient(
      address,
      channelContractId,
      { log },
    );

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: result.released > 0
        ? `Released ${result.released} escrow(s)`
        : "No pending escrows for this recipient",
      data: {
        released: result.released,
        totalReleased: result.totalReleased.toString(),
        totalFees: result.totalFees.toString(),
      },
    };
  };
}
