import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilJurisdictionRepository } from "@/persistence/drizzle/repository/council-jurisdiction.repository.ts";
import { requireCouncilId, requireCouncilOwnership } from "./helpers.ts";
import { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
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
    try {
      const councilId = requireCouncilId(ctx);
      if (!councilId) return;
      if (!await requireCouncilOwnership(ctx, councilId, metadataRepo)) return;

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
    } catch (error) {
      log.error(error, "failed to list jurisdictions");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to retrieve jurisdictions" };
    }
  };
}

export function handleAddJurisdiction(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("addJurisdiction");

  return async (ctx) => {
    log.info("addJurisdiction");
    try {
      const councilId = requireCouncilId(ctx);
      if (!councilId) return;
      if (!await requireCouncilOwnership(ctx, councilId, metadataRepo)) return;
      log.debug("councilId", councilId);

      const body = await ctx.request.body.json();
      const { countryCode, label } = body;

      if (!countryCode || typeof countryCode !== "string") {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "countryCode is required" };
        return;
      }

      const code = countryCode.toUpperCase();
      if (!COUNTRY_CODE_RE.test(code)) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = {
          message:
            "countryCode must be a valid ISO 3166-1 alpha-2 code (e.g. US, BR, DE)",
        };
        return;
      }

      const existing = await jurisdictionRepo.findByCountryCode(
        councilId,
        code,
      );
      if (existing) {
        ctx.response.status = Status.Conflict;
        ctx.response.body = { message: `Jurisdiction ${code} already exists` };
        return;
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
    } catch (error) {
      if (error instanceof SyntaxError) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "Invalid request body" };
      } else {
        log.error(error, "failed to add jurisdiction");
        ctx.response.status = Status.InternalServerError;
        ctx.response.body = { message: "Failed to add jurisdiction" };
      }
    }
  };
}

type RouteParams = { code?: string };

export function handleRemoveJurisdiction(
  deps: { log: Logger },
): (ctx: Context) => Promise<void> {
  const log = deps.log.scope("removeJurisdiction");

  return async (ctx) => {
    log.info("removeJurisdiction");
    try {
      const councilId = requireCouncilId(ctx);
      if (!councilId) return;
      if (!await requireCouncilOwnership(ctx, councilId, metadataRepo)) return;
      log.debug("councilId", councilId);

      const params = (ctx as unknown as { params?: RouteParams }).params;
      const code = params?.code?.toUpperCase();

      if (!code || !COUNTRY_CODE_RE.test(code)) {
        ctx.response.status = Status.BadRequest;
        ctx.response.body = { message: "Valid country code is required" };
        return;
      }

      const existing = await jurisdictionRepo.findByCountryCode(
        councilId,
        code,
      );
      if (!existing) {
        ctx.response.status = Status.NotFound;
        ctx.response.body = { message: `Jurisdiction ${code} not found` };
        return;
      }

      await jurisdictionRepo.delete(existing.id);

      log.debug("countryCode", code);
      log.event("jurisdiction removed");

      ctx.response.status = Status.OK;
      ctx.response.body = { message: `Jurisdiction ${code} removed` };
    } catch (error) {
      log.error(error, "failed to remove jurisdiction");
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to remove jurisdiction" };
    }
  };
}
