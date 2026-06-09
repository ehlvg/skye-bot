import { getDb } from "../../core/db.js";
import type { ModuleContext } from "../../core/module.js";
import { readFile as fsReadFile, readdir, mkdir, rm, writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { log } from "../../utils/log.js";

export interface UserSkill {
  id: number;
  userId: number;
  name: string;
  enabled: boolean;
  createdAt: string;
}

type SkillRow = {
  id: number;
  userId: number;
  name: string;
  enabled: number;
  createdAt: string;
};

export interface SkillManifest {
  name: string;
  description?: string;
  files: Record<string, string>;
}

export interface SkillsService {
  list(userId: number): UserSkill[];
  get(id: number, userId: number): UserSkill | null;
  add(userId: number, name: string): number;
  toggle(id: number, userId: number, enabled: boolean): boolean;
  remove(id: number, userId: number): boolean;
  loadSkill(userId: number, skillName: string): Promise<SkillManifest | null>;
  readFile(userId: number, skillName: string, filePath: string): Promise<string | null>;
  getSkillDir(userId: number, skillName: string): string;
}

export function createSkillsService(ctx: ModuleContext): SkillsService {
  const baseDir = String(ctx.config.SKILLS_BASE_DIR);

  if (!existsSync(baseDir)) {
    mkdirp(baseDir);
  }

  function mkdirp(dir: string) {
    if (!existsSync(dir)) {
      mkdirp(join(dir, ".."));
      mkdirSync(dir, { recursive: true });
    }
  }

  function userDir(userId: number): string {
    const dir = join(baseDir, String(userId));
    if (!existsSync(dir)) {
      mkdirp(dir);
    }
    return dir;
  }

  function getSkillDir(userId: number, skillName: string): string {
    return join(userDir(userId), skillName);
  }

  function list(userId: number): UserSkill[] {
    return getDb()
      .prepare<[number], SkillRow>(
        `SELECT id, user_id AS userId, name, enabled, created_at AS createdAt
         FROM user_skills WHERE user_id = ? ORDER BY created_at`
      )
      .all(userId)
      .map((r) => ({ ...r, enabled: r.enabled === 1 }));
  }

  function get(id: number, userId: number): UserSkill | null {
    const row = getDb()
      .prepare<[number, number], SkillRow>(
        `SELECT id, user_id AS userId, name, enabled, created_at AS createdAt
         FROM user_skills WHERE id = ? AND user_id = ?`
      )
      .get(id, userId);
    if (!row) return null;
    return { ...row, enabled: row.enabled === 1 };
  }

  function add(userId: number, name: string): number {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
    const result = getDb()
      .prepare(
        `INSERT OR IGNORE INTO user_skills (user_id, name, enabled, created_at) VALUES (?, ?, 1, ?)`
      )
      .run(userId, safeName, new Date().toISOString());
    if (result.changes === 0) {
      throw new Error(`Skill "${safeName}" already exists`);
    }
    return Number(result.lastInsertRowid);
  }

  function toggle(id: number, userId: number, enabled: boolean): boolean {
    const result = getDb()
      .prepare(`UPDATE user_skills SET enabled = ? WHERE id = ? AND user_id = ?`)
      .run(enabled ? 1 : 0, id, userId);
    return result.changes > 0;
  }

  function remove(id: number, userId: number): boolean {
    const skill = get(id, userId);
    if (!skill) return false;

    const result = getDb()
      .prepare(`DELETE FROM user_skills WHERE id = ? AND user_id = ?`)
      .run(id, userId);

    if (result.changes > 0) {
      const dir = getSkillDir(userId, skill.name);
      rm(dir, { recursive: true, force: true }).catch((e) =>
        log.warn({ dir, err: e }, "Failed to remove skill directory")
      );
    }

    return result.changes > 0;
  }

  async function loadSkill(userId: number, skillName: string): Promise<SkillManifest | null> {
    const safeName = skillName.replace(/[^a-zA-Z0-9_-]/g, "-");
    const dir = getSkillDir(userId, safeName);
    const skillMdPath = join(dir, "SKILL.md");

    if (!existsSync(skillMdPath)) return null;

    const content = await fsReadFile(skillMdPath, { encoding: "utf-8" });
    const files: Record<string, string> = { "SKILL.md": content };

    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name !== "SKILL.md") {
          // Only load text-based files
          const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
          const textExts = new Set([
            "md",
            "txt",
            "json",
            "js",
            "ts",
            "py",
            "sh",
            "yml",
            "yaml",
            "toml",
            "cfg",
            "ini",
            "env",
            "css",
            "html",
            "xml",
            "sql",
          ]);
          if (textExts.has(ext) || entry.name.startsWith(".")) {
            try {
              const fileContent = await fsReadFile(join(dir, entry.name), { encoding: "utf-8" });
              files[entry.name] = fileContent;
            } catch {
              // skip binary files
            }
          }
        }
      }
    } catch {
      // no other files
    }

    return { name: safeName, files };
  }

  async function readSkillFile(
    userId: number,
    skillName: string,
    filePath: string
  ): Promise<string | null> {
    const safeName = skillName.replace(/[^a-zA-Z0-9_-]/g, "-");
    const safePath = filePath.replace(/\.\./g, "").replace(/^\//, "");
    const fullPath = join(getSkillDir(userId, safeName), safePath);

    if (!existsSync(fullPath)) return null;
    try {
      return await fsReadFile(fullPath, { encoding: "utf-8" });
    } catch {
      return null;
    }
  }

  return { list, get, add, toggle, remove, loadSkill, readFile: readSkillFile, getSkillDir };
}

export async function saveSkillFiles(
  userId: number,
  skillName: string,
  files: Record<string, Buffer | string>,
  baseDir: string
): Promise<string> {
  const safeName = skillName.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
  const dir = join(baseDir, String(userId), safeName);
  await mkdir(dir, { recursive: true });

  const hasSkillMd = Object.keys(files).some(
    (name) => name.toUpperCase() === "SKILL.MD" || basename(name).toUpperCase() === "SKILL.MD"
  );

  if (!hasSkillMd) {
    throw new Error("Skill must contain a SKILL.md file");
  }

  for (const [name, content] of Object.entries(files)) {
    const fileName = name.includes("/") ? basename(name) : name.replace(/^.*[\\/]/, "");
    const filePath = join(dir, fileName);

    if (typeof content === "string") {
      await writeFile(filePath, content, "utf-8");
    } else {
      await writeFile(filePath, new Uint8Array(content));
    }
  }

  return safeName;
}
