import { Logger, LogLevel } from "@/utils/logger/index.ts";
import { loadOptionalEnv } from "@/utils/env/loadEnv.ts";

const LOG_LEVEL = (loadOptionalEnv("LOG_LEVEL") ?? "INFO") as keyof typeof LogLevel;

if (LOG_LEVEL !== undefined && LOG_LEVEL in LogLevel) {
  // Valid log level
} else {
  console.warn(
    `Invalid LOG_LEVEL: "${LOG_LEVEL}". Falling back to INFO. Valid values: ${Object.keys(LogLevel).filter((k) => isNaN(Number(k))).join(", ")}`,
  );
}

let LOG = new Logger(LogLevel[LOG_LEVEL] ?? LogLevel.INFO);

export { LOG };
