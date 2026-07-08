import type { Context } from "@oak/oak";
import type { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import type { CouncilMetadata } from "@/persistence/drizzle/entity/council-metadata.entity.ts";
import * as E from "@/http/v1/council/error.ts";

/**
 * Extract councilId from the query string, or throw a structured
 * `MISSING_COUNCIL_ID` (400) that the edge translates to an `ErrorResponse`.
 */
export function requireCouncilId(ctx: Context): string {
  const councilId = ctx.request.url.searchParams.get("councilId");
  if (!councilId) {
    throw new E.MISSING_COUNCIL_ID();
  }
  return councilId;
}

/**
 * Verify the authenticated user owns the council. Returns the council when
 * owned; otherwise throws a structured `COUNCIL_NOT_FOUND` (404).
 */
export async function requireCouncilOwnership(
  ctx: Context,
  councilId: string,
  metadataRepo: CouncilMetadataRepository,
): Promise<CouncilMetadata> {
  const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
  const council = await metadataRepo.getByIdAndOwner(councilId, ownerPublicKey);
  if (!council) {
    throw new E.COUNCIL_NOT_FOUND();
  }
  return council;
}
