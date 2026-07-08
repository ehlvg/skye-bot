import { z } from "zod";

export const panelEnvSchema = z.object({
  PANEL_WEBAPP_URL: z.string().url().default("http://localhost:3001"),
  PANEL_WEBAPP_PORT: z.coerce.number().positive().default(3001),
});
