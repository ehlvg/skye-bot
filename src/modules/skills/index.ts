import type { SkyeModule, ToolDefinition } from "../../core/module.js";
import { skillsMigrations } from "./migrations.js";
import { buildRoutes } from "./routes.js";
import { createSkillsService, type SkillsService } from "./service.js";
import { skillsEnvSchema } from "./env.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    skills: SkillsService;
  }
}

const skillTools: ToolDefinition[] = [
  {
    name: "read_skill_file",
    description:
      "Read a file from a loaded skill's directory. Use this to access scripts, " +
      "templates, or reference files that are part of the skill.",
    parameters: {
      type: "object",
      properties: {
        skillName: {
          type: "string",
          description: "The name of the skill (e.g. 'python-tutor').",
        },
        filePath: {
          type: "string",
          description:
            "Path to the file relative to the skill directory (e.g. 'examples/hello.py').",
        },
      },
      required: ["skillName", "filePath"],
    },
    execute: async (args, tenant) => {
      const userId = tenant.userId ?? tenant.chatId;
      const skillName = String(args.skillName ?? "");
      const filePath = String(args.filePath ?? "");
      const svc = ctxRef as SkillsService | null;
      if (!svc) return "Skills service not available.";
      const content = await svc.readFile(userId, skillName, filePath);
      return content ?? `File not found: ${filePath}`;
    },
  },
];

let ctxRef: SkillsService | null = null;

export const skillsModule: SkyeModule = {
  name: "skills",
  envSchema: skillsEnvSchema,
  migrations: skillsMigrations,
  init(ctx) {
    const svc = createSkillsService(ctx);
    ctxRef = svc;
    ctx.services.set("skills", svc);
    return {
      service: svc,
      tools: [
        {
          ...skillTools[0],
          execute: async (args, tenant) => {
            const userId = tenant.userId ?? tenant.chatId;
            const skillName = String(args.skillName ?? "");
            const filePath = String(args.filePath ?? "");
            const content = await svc.readFile(userId, skillName, filePath);
            return content ?? `File not found: ${filePath}`;
          },
        },
      ],
      panelRoutes: buildRoutes(ctx),
    };
  },
};
