import { z } from "zod";

export const workspaceEnvSchema = z.object({
  WORKSPACE_BASE_DIR: z.string().default("/data/workspaces"),
  WORKSPACE_IMAGE: z.string().default("skye-workspace:latest"),
  WORKSPACE_MEMORY_LIMIT: z.string().default("512m"),
  WORKSPACE_CPU_LIMIT: z.string().default("1"),
  WORKSPACE_TIMEOUT_SEC: z.coerce.number().int().positive().default(30),
});
