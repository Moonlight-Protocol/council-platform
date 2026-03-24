import type { ErrorResponse } from "@/http/default-schemas.ts";

export type PlatformErrorShape<M> = {
  code: string;
  message: string;
  source: string;
  details?: string;
  meta?: M;
  baseError?: Error | unknown;
  api?: APIDetails;
};

export type ApiError = ErrorResponse;
export type APIDetails = Omit<ApiError, "code">;
