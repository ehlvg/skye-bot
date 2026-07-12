import { z } from "zod";

function parseBool(value: string): boolean {
  return value === "1" || value.toLowerCase() === "true";
}

export const sandboxEnvSchema = z.object({
  DAYTONA_API_KEY: z.string().min(1).optional(),
  DAYTONA_API_URL: z.string().url().optional(),
  DAYTONA_TARGET: z.string().min(1).optional(),
  SANDBOX_DAYTONA_API_KEY: z.string().min(1).optional(),
  SANDBOX_DAYTONA_API_URL: z.string().url().optional(),
  SANDBOX_DAYTONA_TARGET: z.string().min(1).optional(),
  SANDBOX_ENABLED: z.string().default("true").transform(parseBool),
  SANDBOX_IMAGE: z.string().min(1).default("node:24-bookworm"),
  SANDBOX_SNAPSHOT: z.string().min(1).optional(),
  SANDBOX_CPU: z.coerce.number().int().positive().max(4).default(1),
  SANDBOX_MEMORY_GIB: z.coerce.number().int().positive().max(8).default(1),
  SANDBOX_DISK_GIB: z.coerce.number().int().positive().max(10).default(3),
  SANDBOX_AUTO_STOP_MINUTES: z.coerce.number().int().nonnegative().default(15),
  SANDBOX_AUTO_ARCHIVE_MINUTES: z.coerce.number().int().nonnegative().default(10_080),
  SANDBOX_COMMAND_TIMEOUT_MS: z
    .string()
    .default(String(60 * 1000))
    .transform((v) => Number(v))
    .pipe(z.number().positive()),
  SANDBOX_PERSISTENT: z.string().default("false").transform(parseBool),
  SANDBOX_MAX_OUTPUT_CHARS: z.coerce.number().int().positive().max(1_000_000).default(64_000),
  SANDBOX_MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024)
    .default(1_000_000),
});

export type SandboxEnv = z.infer<typeof sandboxEnvSchema>;
