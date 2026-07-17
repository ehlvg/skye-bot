import { z } from "zod";
import { section } from "../../core/config.js";

export const panelConfigSchema = z.object({
  panel: section({
    webapp_url: z.string().url().default("http://localhost:3001"),
    webapp_port: z.number().int().positive().default(3001),
  }),
});

export type PanelConfig = z.infer<typeof panelConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    panel: { webapp_url: string; webapp_port: number };
  }
}