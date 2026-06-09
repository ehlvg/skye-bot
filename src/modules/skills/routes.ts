import type { ModuleContext, PanelRoute } from "../../core/module.js";
import type { PanelRequest } from "../panel/index.js";
import type { SkillsService } from "./service.js";
import { saveSkillFiles } from "./service.js";
import { log } from "../../utils/log.js";

export function buildRoutes(ctx: ModuleContext): PanelRoute[] {
  const svc = ctx.services.get("skills") as SkillsService;
  const baseDir = String(ctx.config.SKILLS_BASE_DIR);

  return [
    {
      method: "get",
      path: "/skills",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        res.json(svc.list(userId));
      },
    },
    {
      method: "post",
      path: "/skills",
      handler: async (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const contentType = req.headers["content-type"] ?? "";

        if (!contentType.includes("multipart/form-data")) {
          res.status(400).json({ error: "Use multipart/form-data upload" });
          return;
        }

        try {
          const files = await parseFormData(req);
          if (Object.keys(files).length === 0) {
            res.status(400).json({ error: "No files uploaded" });
            return;
          }

          // Determine skill name from first SKILL.md or from directory name
          let skillName = "";
          for (const [name] of Object.entries(files)) {
            if (name.toUpperCase().endsWith("SKILL.MD")) {
              skillName =
                name
                  .replace(/\/?SKILL\.MD$/i, "")
                  .split("/")
                  .pop() ?? "";
              break;
            }
          }

          if (!skillName) {
            // Use the first filename's directory or generate one
            const firstKey = Object.keys(files)[0];
            skillName = firstKey.replace(/\/.*$/, "") || "untitled";
          }

          const safeName = await saveSkillFiles(userId, skillName, files, baseDir);
          const id = svc.add(userId, safeName);

          res.json({ id, name: safeName, enabled: true });
        } catch (e) {
          log.error({ userId, err: e }, "Failed to upload skill");
          res.status(500).json({ error: String(e) });
        }
      },
    },
    {
      method: "put",
      path: "/skills/:id",
      handler: async (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const id = Number(req.params.id);
        const { enabled } = req.body as { enabled?: boolean };

        if (typeof enabled !== "boolean") {
          res.status(400).json({ error: "enabled (boolean) is required" });
          return;
        }

        const ok = svc.toggle(id, userId, enabled);
        if (!ok) {
          res.status(404).json({ error: "Skill not found" });
          return;
        }

        const skill = svc.get(id, userId);
        res.json(skill);
      },
    },
    {
      method: "delete",
      path: "/skills/:id",
      handler: async (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const id = Number(req.params.id);

        const ok = svc.remove(id, userId);
        if (!ok) {
          res.status(404).json({ error: "Skill not found" });
          return;
        }
        res.json({ ok: true });
      },
    },
  ];
}

async function parseFormData(req: import("express").Request): Promise<Record<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const buffer = Buffer.concat(chunks);
      const contentType = req.headers["content-type"] ?? "";

      const boundaryMatch = contentType.match(/boundary=(.+)$/);
      if (!boundaryMatch) {
        resolve({});
        return;
      }

      const boundary = boundaryMatch[1].replace(/^["']|["']$/g, "");
      const parts = parseMultipart(buffer, boundary);
      resolve(parts);
    });
    req.on("error", reject);
  });
}

function parseMultipart(buffer: Buffer, boundary: string): Record<string, Buffer> {
  const result: Record<string, Buffer> = {};
  const boundaryBuf = Buffer.from("--" + boundary);

  let pos = buffer.indexOf(boundaryBuf);
  if (pos === -1) return result;

  while (pos !== -1) {
    const nextBoundary = buffer.indexOf(boundaryBuf, pos + boundaryBuf.length);
    if (nextBoundary === -1) break;

    const section = buffer.subarray(pos + boundaryBuf.length + 2, nextBoundary - 2);

    const headerEnd = section.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      pos = nextBoundary;
      continue;
    }

    const headerStr = section.subarray(0, headerEnd).toString("utf-8");
    const body = section.subarray(headerEnd + 4);

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);

    if (filenameMatch && nameMatch) {
      // For zip files, the filename is the original name inside the zip
      // We store by the original filename
      result[filenameMatch[1]] = Buffer.from(body);
    } else if (nameMatch && nameMatch[1] === "file") {
      const fnMatch = headerStr.match(/filename="([^"]+)"/);
      if (fnMatch) {
        result[fnMatch[1]] = Buffer.from(body);
      }
    }

    pos = nextBoundary;
  }

  return result;
}
