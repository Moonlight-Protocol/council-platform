import { type Context, Status } from "@oak/oak";
import { StrKey } from "@colibri/core";
import {
  getRecipientUtxos,
  createEscrow,
  getEscrowSummary,
  releaseEscrowsForRecipient,
} from "@/core/service/escrow/escrow.service.ts";
import type { JwtSessionData } from "@/http/middleware/auth/index.ts";
import { LOG } from "@/config/logger.ts";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilProviderRepository } from "@/persistence/drizzle/repository/council-provider.repository.ts";

const providerRepo = new CouncilProviderRepository(drizzleClient);
const AMOUNT_RE = /^\d+$/;

type RouteParams = { address?: string };

/**
 * GET /council/recipient/:address/utxos
 *
 * PP checks if a recipient has UTXO addresses for a channel.
 * Query param: ?channelContractId=C...&count=1
 */
export const getRecipientUtxosHandler = async (ctx: Context) => {
  try {
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const address = params?.address;

    if (!address) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Recipient address is required" };
      return;
    }

    const channelContractId = ctx.request.url.searchParams.get("channelContractId");
    if (!channelContractId) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "channelContractId query param is required" };
      return;
    }

    const councilId = ctx.request.url.searchParams.get("councilId");
    if (!councilId) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "councilId query param is required" };
      return;
    }

    const count = Number(ctx.request.url.searchParams.get("count") || "1");
    if (!Number.isInteger(count) || count < 1 || count > 300) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "count must be 1-300" };
      return;
    }

    const result = await getRecipientUtxos(councilId, address, channelContractId, count);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: result.registered ? "Recipient has UTXO addresses" : "Recipient not registered",
      data: result,
    };
  } catch (error) {
    LOG.error("Failed to check recipient UTXOs", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to check recipient" };
  }
};

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
export const postEscrowHandler = async (ctx: Context) => {
  try {
    const session = ctx.state.session as JwtSessionData;

    const body = await ctx.request.body.json();
    const { councilId, senderAddress, recipientAddress, amount, assetCode, channelContractId } = body;

    if (!councilId || !senderAddress || !recipientAddress || !amount || !assetCode || !channelContractId) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = {
        message: "councilId, senderAddress, recipientAddress, amount, assetCode, and channelContractId are required",
      };
      return;
    }

    if (typeof amount !== "string" || !AMOUNT_RE.test(amount)) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "amount must be a positive integer string (stroops)" };
      return;
    }

    const amountBigInt = BigInt(amount);
    if (amountBigInt <= 0n) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "amount must be positive" };
      return;
    }

    if (!StrKey.isValidContractId(channelContractId)) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid channelContractId" };
      return;
    }

    // Verify the calling provider belongs to this council
    const provider = await providerRepo.findByPublicKey(councilId, session.sub);
    if (!provider) {
      ctx.response.status = Status.Forbidden;
      ctx.response.body = { message: "Provider not a member of this council" };
      return;
    }

    const result = await createEscrow({
      councilId,
      senderAddress,
      recipientAddress,
      amount: amountBigInt,
      assetCode,
      channelContractId,
      submittedByProvider: session.sub,
    });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Escrow created",
      data: result,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid request body" };
    } else {
      LOG.error("Failed to create escrow", {
        error: error instanceof Error ? error.message : String(error),
      });
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to create escrow" };
    }
  }
};

/**
 * GET /council/escrow/:address
 *
 * Get pending escrow summary for a recipient.
 * Available to providers (to show users their pending funds).
 */
export const getEscrowSummaryHandler = async (ctx: Context) => {
  try {
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const address = params?.address;

    if (!address) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Recipient address is required" };
      return;
    }

    const summary = await getEscrowSummary(address);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Escrow summary retrieved",
      data: {
        pendingCount: summary.pendingCount,
        pendingTotal: summary.pendingTotal.toString(),
        escrows: summary.escrows,
      },
    };
  } catch (error) {
    LOG.error("Failed to get escrow summary", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve escrow summary" };
  }
};

/**
 * POST /council/escrow/:address/release
 *
 * Triggers escrow release for a recipient after KYC completion.
 * Admin-only — called when the council confirms KYC.
 *
 * Body: { channelContractId: string }
 */
export const postEscrowReleaseHandler = async (ctx: Context) => {
  try {
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const address = params?.address;

    if (!address) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Recipient address is required" };
      return;
    }

    const body = await ctx.request.body.json();
    const { channelContractId } = body;

    if (!channelContractId || !StrKey.isValidContractId(channelContractId)) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Valid channelContractId is required" };
      return;
    }

    const result = await releaseEscrowsForRecipient(address, channelContractId);

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
  } catch (error) {
    if (error instanceof SyntaxError) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Invalid request body" };
    } else {
      LOG.error("Failed to release escrow", {
        error: error instanceof Error ? error.message : String(error),
      });
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to release escrow" };
    }
  }
};
