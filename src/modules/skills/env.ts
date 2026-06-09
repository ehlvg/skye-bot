import { z } from "zod";

export const skillsEnvSchema = z.object({
  SKILLS_BASE_DIR: z.string().default("/data/skills"),
});
