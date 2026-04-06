import { type Context, Status } from "@oak/oak";
import type { CouncilMetadataRepository } from "@/persistence/drizzle/repository/council-metadata.repository.ts";
import type { CouncilMetadata } from "@/persistence/drizzle/entity/council-metadata.entity.ts";

/**
 * Extract councilId from query parameter. Returns null and sets 400 response if missing.
 */
export function requireCouncilId(ctx: Context): string | null {
  const councilId = ctx.request.url.searchParams.get("councilId");
  if (!councilId) {
    ctx.response.status = Status.BadRequest;
    ctx.response.body = { message: "councilId query parameter is required" };
    return null;
  }
  return councilId;
}

/**
 * Verify the authenticated user owns the specified council.
 * Returns the council if owned, null otherwise (with 404 response set).
 */
export async function requireCouncilOwnership(
  ctx: Context,
  councilId: string,
  metadataRepo: CouncilMetadataRepository,
): Promise<CouncilMetadata | null> {
  const ownerPublicKey = (ctx.state.session as { sub: string }).sub;
  const council = await metadataRepo.getByIdAndOwner(councilId, ownerPublicKey);
  if (!council) {
    ctx.response.status = Status.NotFound;
    ctx.response.body = { message: "Council not found" };
    return null;
  }
  return council;
}
