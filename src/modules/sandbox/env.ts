import { z } from "zod";

function parseBool(value: string): boolean {
  return value === "1" || value.toLowerCase() === "true";
}

export const sandboxEnvSchema = z.object({
  VERCEL_ACCESS_TOKEN: z.string().min(1).optional(),
  VERCEL_TEAM_ID: z.string().min(1).optional(),
  VERCEL_PROJECT_ID: z.string().min(1).optional(),
  SANDBOX_ENABLED: z.string().default("true").transform(parseBool),
  SANDBOX_RUNTIME: z.string().default("node24"),
  SANDBOX_TIMEOUT_MS: z
    .string()
    .default(String(5 * 60 * 1000))
    .transform((v) => Number(v))
    .pipe(z.number().positive()),
  SANDBOX_VCPUS: z
    .string()
    .default("2")
    .transform((v) => Number(v))
    .pipe(z.number().positive().int()),
  SANDBOX_PERSISTENT: z.string().default("false").transform(parseBool),
  SANDBOX_COMMAND_TIMEOUT_MS: z
    .string()
    .default(String(60 * 1000))
    .transform((v) => Number(v))
    .pipe(z.number().positive()),
  SANDBOX_NETWORK_POLICY: z.enum(["deny-all", "allow-all"]).default("deny-all"),
  SANDBOX_MAX_OUTPUT_CHARS: z.coerce.number().int().positive().max(1_000_000).default(64_000),
  SANDBOX_MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024)
    .default(1_000_000),
  SANDBOX_MAX_ARGS: z.coerce.number().int().positive().max(256).default(64),
  SANDBOX_MAX_ARG_CHARS: z.coerce.number().int().positive().max(100_000).default(4_096),
});

export type SandboxEnv = z.infer<typeof sandboxEnvSchema>;
