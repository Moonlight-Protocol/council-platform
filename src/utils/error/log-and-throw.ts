import type { Logger } from "@/utils/logger/index.ts";

export function logAndThrow(log: Logger, error: Error): never {
  log.error(error, error.message);
  throw error;
}
