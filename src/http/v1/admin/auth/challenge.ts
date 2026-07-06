import { type Context, Status } from "@oak/oak";
import { Keypair } from "stellar-sdk";
import { createCouncilChallenge } from "@/core/service/auth/council-auth.ts";
import * as E from "@/http/v1/error.ts";
import type { Logger } from "@/utils/logger/index.ts";

export function handlePostChallenge(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("postChallenge");

  return async (ctx) => {
    log.info("postChallenge");

    let body;
    try {
      body = await ctx.request.body.json();
    } catch (error) {
      throw new E.INVALID_REQUEST_BODY(error);
    }
    const { publicKey } = body;

    if (!publicKey || typeof publicKey !== "string") {
      throw new E.VALIDATION_FAILED("publicKey is required");
    }

    try {
      Keypair.fromPublicKey(publicKey);
    } catch {
      throw new E.VALIDATION_FAILED("Invalid Stellar public key format");
    }

    // createCouncilChallenge throws a structured TOO_MANY_CHALLENGES (429) that
    // the edge translates; no ad-hoc catch needed.
    const { nonce } = createCouncilChallenge(publicKey, { log });

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Challenge created",
      data: { nonce },
    };
  };
}
