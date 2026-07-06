import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilJurisdictionRepository } from "@/persistence/drizzle/repository/council-jurisdiction.repository.ts";
import { requireCouncilId, requireCouncilOwnership } from "./helpers.ts";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import * as E from "@/http/v1/error.ts";
import type { Logger } from "@/utils/logger/index.ts";

const metadataRepo = new CouncilMetadataRepository(drizzleClient);

const jurisdictionRepo = new CouncilJurisdictionRepository(drizzleClient);

const COUNTRY_CODE_RE = /^[A-Z]{2}$/;

export function handleListJurisdictions(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("listJurisdictions");

  return async (ctx) => {
    log.info("listJurisdictions");
    const councilId = requireCouncilId(ctx);
    await requireCouncilOwnership(ctx, councilId, metadataRepo);

    const jurisdictions = await jurisdictionRepo.listAll(councilId);

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Jurisdictions retrieved",
      data: jurisdictions.map((j) => ({
        id: j.id,
        countryCode: j.countryCode,
        label: j.label,
      })),
    };
  };
}

export function handleAddJurisdiction(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("addJurisdiction");

  return async (ctx) => {
    log.info("addJurisdiction");
    const councilId = requireCouncilId(ctx);
    await requireCouncilOwnership(ctx, councilId, metadataRepo);
    log.debug("councilId", councilId);

    let body;
    try {
      body = await ctx.request.body.json();
    } catch (error) {
      throw new E.INVALID_REQUEST_BODY(error);
    }
    const { countryCode, label } = body;

    if (!countryCode || typeof countryCode !== "string") {
      throw new E.VALIDATION_FAILED("countryCode is required");
    }

    const code = countryCode.toUpperCase();
    if (!COUNTRY_CODE_RE.test(code)) {
      throw new E.VALIDATION_FAILED(
        "countryCode must be a valid ISO 3166-1 alpha-2 code (e.g. US, BR, DE)",
      );
    }

    const existing = await jurisdictionRepo.findByCountryCode(
      councilId,
      code,
    );
    if (existing) {
      throw new E.RESOURCE_CONFLICT(`Jurisdiction ${code} already exists`);
    }

    const deleted = await jurisdictionRepo.findDeletedByCountryCode(
      councilId,
      code,
    );
    let jurisdiction;
    if (deleted) {
      jurisdiction = await jurisdictionRepo.update(deleted.id, {
        deletedAt: null,
        label: label?.trim() ?? deleted.label,
      });
    } else {
      jurisdiction = await jurisdictionRepo.create({
        id: crypto.randomUUID(),
        councilId,
        countryCode: code,
        label: label?.trim() ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    log.debug("countryCode", code);
    log.event("jurisdiction added");

    ctx.response.status = Status.OK;
    ctx.response.body = {
      message: "Jurisdiction added",
      data: {
        id: jurisdiction.id,
        countryCode: jurisdiction.countryCode,
        label: jurisdiction.label,
      },
    };
  };
}

type RouteParams = { code?: string };

export function handleRemoveJurisdiction(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("removeJurisdiction");

  return async (ctx) => {
    log.info("removeJurisdiction");
    const councilId = requireCouncilId(ctx);
    await requireCouncilOwnership(ctx, councilId, metadataRepo);
    log.debug("councilId", councilId);

    const params = (ctx as unknown as { params?: RouteParams }).params;
    const code = params?.code?.toUpperCase();

    if (!code || !COUNTRY_CODE_RE.test(code)) {
      throw new E.VALIDATION_FAILED("Valid country code is required");
    }

    const existing = await jurisdictionRepo.findByCountryCode(
      councilId,
      code,
    );
    if (!existing) {
      throw new E.RESOURCE_NOT_FOUND(`Jurisdiction ${code} not found`);
    }

    await jurisdictionRepo.delete(existing.id);

    log.debug("countryCode", code);
    log.event("jurisdiction removed");

    ctx.response.status = Status.OK;
    ctx.response.body = { message: `Jurisdiction ${code} removed` };
  };
}
