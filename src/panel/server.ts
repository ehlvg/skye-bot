import express, { type Request, type Response, type NextFunction } from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { WEBAPP_PORT } from "../config.js";
import { validateInitData, type ValidatedInitData } from "./auth.js";
import {
  getUserConfig,
  setUserConfig,
  getUserMcpServers,
  getUserMcpServer,
  addUserMcpServer,
  updateUserMcpServer,
  deleteUserMcpServer,
  setUserMcpInput,
  type UserConfig,
} from "../userConfig.js";
import { getChatConfig, setChatFastMode, setChatVoiceMode } from "../chatConfig.js";
import { deleteMemory, clearMemories } from "../memory.js";
import { getDb } from "../db.js";
import {
  connectUserMcpServer,
  disconnectUserMcpServer,
  getUserMcpToolCount,
} from "../mcp.js";
import { log } from "../utils/log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const tgUsers = new WeakMap<Request, ValidatedInitData>();

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const initData = req.headers["x-telegram-init-data"];
  if (typeof initData !== "string") {
    res.status(401).json({ error: "Missing init data" });
    return;
  }

  const validated = validateInitData(initData);
  if (!validated) {
    res.status(401).json({ error: "Invalid init data" });
    return;
  }

  tgUsers.set(req, validated);
  next();
}

function getUserId(req: Request): number {
  return tgUsers.get(req)!.user.id;
}

export function startPanelServer(): express.Application {
  const app = express();
  app.use(express.json());

  app.use("/api", authMiddleware);

  app.get("/api/config", (req, res) => {
    const userId = getUserId(req);
    res.json(getUserConfig(userId));
  });

  app.put("/api/config", (req, res) => {
    const userId = getUserId(req);
    const body = req.body as Partial<UserConfig>;
    const allowed: (keyof UserConfig)[] = ["apiKey", "baseUrl", "model", "maxTokens", "systemPrompt"];
    const clean: UserConfig = {};
    for (const key of allowed) {
      if (body[key] !== undefined) {
        (clean as Record<string, unknown>)[key] = body[key];
      }
    }
    setUserConfig(userId, clean);
    res.json(getUserConfig(userId));
  });

  app.get("/api/mcp", (req, res) => {
    const userId = getUserId(req);
    const servers = getUserMcpServers(userId);
    const result = servers.map((s) => ({
      id: s.id,
      name: s.name,
      config: s.config,
      connected: true,
      toolCount: getUserMcpToolCount(userId, s.id),
    }));
    res.json(result);
  });

  app.post("/api/mcp", async (req, res) => {
    const userId = getUserId(req);
    const { name, config, inputs } = req.body;
    if (!name || !config) {
      res.status(400).json({ error: "Name and config are required" });
      return;
    }

    const id = addUserMcpServer(userId, name, config);

    if (inputs && typeof inputs === "object") {
      for (const [inputId, value] of Object.entries(inputs)) {
        setUserMcpInput(id, inputId, value as string);
      }
    }

    try {
      await connectUserMcpServer(userId, id, name, config, inputs ?? {});
    } catch (e) {
      log.error({ userId, server: name, err: e }, "Failed to connect user MCP server");
    }

    res.json({ id, name, config, connected: true, toolCount: getUserMcpToolCount(userId, id) });
  });

  app.put("/api/mcp/:id", async (req, res) => {
    const userId = getUserId(req);
    const id = Number(req.params.id);
    const { name, config, inputs } = req.body;

    const existing = getUserMcpServer(id, userId);
    if (!existing) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    await disconnectUserMcpServer(userId, id);
    updateUserMcpServer(id, userId, name ?? existing.name, config ?? existing.config);

    if (inputs && typeof inputs === "object") {
      for (const [inputId, value] of Object.entries(inputs)) {
        setUserMcpInput(id, inputId, value as string);
      }
    }

    try {
      await connectUserMcpServer(
        userId,
        id,
        name ?? existing.name,
        config ?? existing.config,
        inputs ?? {}
      );
    } catch (e) {
      log.error({ userId, server: name, err: e }, "Failed to reconnect user MCP server");
    }

    res.json({
      id,
      name: name ?? existing.name,
      config: config ?? existing.config,
      connected: true,
      toolCount: getUserMcpToolCount(userId, id),
    });
  });

  app.delete("/api/mcp/:id", async (req, res) => {
    const userId = getUserId(req);
    const id = Number(req.params.id);

    await disconnectUserMcpServer(userId, id);
    const deleted = deleteUserMcpServer(id, userId);

    if (!deleted) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    res.json({ ok: true });
  });

  app.get("/api/memories", (req, res) => {
    const userId = getUserId(req);
    const rows = getDb()
      .prepare<[number], { id: string; content: string; createdAt: string; chatId: number }>(
        `SELECT m.id, m.content, m.created_at AS createdAt, m.chat_id AS chatId
         FROM memories m
         WHERE m.chat_id IN (SELECT DISTINCT chat_id FROM request_logs WHERE user_id = ?)
         ORDER BY m.created_at DESC LIMIT 100`
      )
      .all(userId);

    res.json(rows);
  });

  app.delete("/api/memories/:chatId/:id", (req, res) => {
    const chatId = Number(req.params.chatId);
    const id = req.params.id;
    deleteMemory(chatId, id);
    res.json({ ok: true });
  });

  app.delete("/api/memories/:chatId", (req, res) => {
    const chatId = Number(req.params.chatId);
    clearMemories(chatId);
    res.json({ ok: true });
  });

  app.get("/api/stats", (req, res) => {
    const userId = getUserId(req);
    const today = new Date().toISOString().slice(0, 10);

    const total = getDb()
      .prepare<[number], { count: number }>(
        `SELECT COUNT(*) as count FROM request_logs WHERE user_id = ?`
      )
      .get(userId);

    const todayCount = getDb()
      .prepare<[number, string], { count: number }>(
        `SELECT COUNT(*) as count FROM request_logs WHERE user_id = ? AND ts LIKE ?`
      )
      .get(userId, `${today}%`);

    const avgLatency = getDb()
      .prepare<[number], { avg: number }>(
        `SELECT AVG(latency_ms) as avg FROM request_logs WHERE user_id = ?`
      )
      .get(userId);

    const errors = getDb()
      .prepare<[number], { count: number }>(
        `SELECT COUNT(*) as count FROM request_logs WHERE user_id = ? AND status = 'error'`
      )
      .get(userId);

    const totalReqs = total?.count ?? 0;
    res.json({
      totalRequests: totalReqs,
      requestsToday: todayCount?.count ?? 0,
      avgLatencyMs: avgLatency?.avg ?? 0,
      errorRate: totalReqs > 0 ? (errors?.count ?? 0) / totalReqs : 0,
    });
  });

  app.get("/api/chat-config", (req, res) => {
    const userId = getUserId(req);
    const row = getDb()
      .prepare<[number], { chatId: number; fastMode: number; voiceMode: number }>(
        `SELECT DISTINCT rl.chat_id AS chatId, cg.fast_mode AS fastMode, cg.voice_mode AS voiceMode
         FROM request_logs rl
         INNER JOIN chat_configs cg ON rl.chat_id = cg.chat_id
         WHERE rl.user_id = ? LIMIT 1`
      )
      .get(userId);

    if (!row) {
      res.json({ fastMode: false, voiceMode: false });
      return;
    }

    res.json({ fastMode: row.fastMode === 1, voiceMode: row.voiceMode === 1 });
  });

  app.put("/api/chat-config", (req, res) => {
    const userId = getUserId(req);
    const body = req.body as { fastMode?: boolean; voiceMode?: boolean };

    const row = getDb()
      .prepare<[number], { chatId: number }>(
        `SELECT DISTINCT chat_id AS chatId FROM request_logs WHERE user_id = ? LIMIT 1`
      )
      .get(userId);

    if (row) {
      if (body.fastMode !== undefined) setChatFastMode(row.chatId, body.fastMode);
      if (body.voiceMode !== undefined) setChatVoiceMode(row.chatId, body.voiceMode);
      const cfg = getChatConfig(row.chatId);
      res.json({ fastMode: cfg.fastMode, voiceMode: cfg.voiceMode });
    } else {
      res.json({ fastMode: body.fastMode ?? false, voiceMode: body.voiceMode ?? false });
    }
  });

  const publicDir = join(__dirname, "..", "..", "web", "dist");
  if (existsSync(publicDir)) {
    app.use(express.static(publicDir));
    app.get("*", (_req, res) => {
      res.sendFile(join(publicDir, "index.html"));
    });
  }

  app.listen(WEBAPP_PORT, () => {
    log.info(`Panel server listening on port ${WEBAPP_PORT}`);
  });

  return app;
}
