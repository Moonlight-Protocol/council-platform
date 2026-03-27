import { type Context, Status } from "@oak/oak";
import { drizzleClient } from "@/persistence/drizzle/config.ts";
import { CouncilJurisdictionRepository } from "@/persistence/drizzle/repository/council-jurisdiction.repository.ts";
import { LOG } from "@/config/logger.ts";

const jurisdictionRepo = new CouncilJurisdictionRepository(drizzleClient);

// ISO 3166-1 alpha-2: exactly 2 uppercase letters
const COUNTRY_CODE_RE = /^[A-Z]{2}$/;

/**
 * GET /council/jurisdictions
 * Lists all active jurisdictions for this council.
 */
export const listJurisdictionsHandler = async (ctx: Context) => {
  try {
    const jurisdictions = await jurisdictionRepo.listAll();

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
    LOG.error("Failed to list jurisdictions", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to retrieve jurisdictions" };
  }
};

/**
 * POST /council/jurisdictions
 * Adds a jurisdiction. Admin-only.
 */
export const addJurisdictionHandler = async (ctx: Context) => {
  try {
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
      ctx.response.body = { message: "countryCode must be a valid ISO 3166-1 alpha-2 code (e.g. US, BR, DE)" };
      return;
    }

    const existing = await jurisdictionRepo.findByCountryCode(code);
    if (existing) {
      ctx.response.status = Status.Conflict;
      ctx.response.body = { message: `Jurisdiction ${code} already exists` };
      return;
    }

    const jurisdiction = await jurisdictionRepo.create({
      id: crypto.randomUUID(),
      countryCode: code,
      label: label?.trim() ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    LOG.info("Jurisdiction added", { countryCode: code });

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
      LOG.error("Failed to add jurisdiction", { error: error instanceof Error ? error.message : String(error) });
      ctx.response.status = Status.InternalServerError;
      ctx.response.body = { message: "Failed to add jurisdiction" };
    }
  }
};

type RouteParams = { code?: string };

/**
 * DELETE /council/jurisdictions/:code
 * Removes a jurisdiction by country code. Admin-only.
 */
export const removeJurisdictionHandler = async (ctx: Context) => {
  try {
    const params = (ctx as unknown as { params?: RouteParams }).params;
    const code = params?.code?.toUpperCase();

    if (!code || !COUNTRY_CODE_RE.test(code)) {
      ctx.response.status = Status.BadRequest;
      ctx.response.body = { message: "Valid country code is required" };
      return;
    }

    const existing = await jurisdictionRepo.findByCountryCode(code);
    if (!existing) {
      ctx.response.status = Status.NotFound;
      ctx.response.body = { message: `Jurisdiction ${code} not found` };
      return;
    }

    await jurisdictionRepo.delete(existing.id);

    LOG.info("Jurisdiction removed", { countryCode: code });

    ctx.response.status = Status.OK;
    ctx.response.body = { message: `Jurisdiction ${code} removed` };
  } catch (error) {
    LOG.error("Failed to remove jurisdiction", {
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.response.status = Status.InternalServerError;
    ctx.response.body = { message: "Failed to remove jurisdiction" };
  }
};
