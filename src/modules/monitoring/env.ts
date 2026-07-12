import { z } from "zod";

export const monitoringEnvSchema = z.object({
  MONITORING_OUT_LOG: z.string().min(1).optional(),
  MONITORING_ERROR_LOG: z.string().min(1).optional(),
});
