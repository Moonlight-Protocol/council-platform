import type { Context } from "@oak/oak";
import { ProcessEngine } from "@fifo/convee";
import type { MetadataHelper } from "@fifo/convee";
import type { ErrorResponse } from "@/http/default-schemas.ts";

const PROCESS_NAME = "SetErrorResponse" as const;

const P_SetErrorResponse = (ctx: Context) => {
  const setApiResponse = (
    response: ErrorResponse,
    _metadataHelper?: MetadataHelper,
  ): Context => {
    ctx.response.status = response.status;
    ctx.response.body = response;
    return ctx;
  };

  return ProcessEngine.create<
    ErrorResponse,
    Context,
    Error,
    typeof PROCESS_NAME
  >(setApiResponse, {
    name: PROCESS_NAME,
  });
};

export { P_SetErrorResponse };
