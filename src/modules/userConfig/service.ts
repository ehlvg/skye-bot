import { getDb } from "../../core/db.js";

export interface UserConfig {
  systemPrompt?: string;
}

type ConfigRow = {
  systemPrompt: string | null;
};

export function getUserConfig(userId: number): UserConfig {
  const row = getDb()
    .prepare<[number], ConfigRow>(
      `SELECT system_prompt AS systemPrompt FROM user_configs WHERE user_id = ?`
    )
    .get(userId);
  if (!row) return {};
  return {
    ...(row.systemPrompt != null ? { systemPrompt: row.systemPrompt } : {}),
  };
}

export function setUserConfig(userId: number, config: UserConfig): void {
  const existing = getUserConfig(userId);
  const merged = { ...existing, ...config };

  getDb()
    .prepare(
      `INSERT INTO user_configs (user_id, system_prompt)
       VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         system_prompt = excluded.system_prompt`
    )
    .run(userId, merged.systemPrompt ?? null);
}

export interface UserMcpServer {
  id: number;
  userId: number;
  name: string;
  config: Record<string, unknown>;
  createdAt: string;
}

type ServerRow = {
  id: number;
  userId: number;
  name: string;
  config: string;
  createdAt: string;
};

export function getUserMcpServers(userId: number): UserMcpServer[] {
  return getDb()
    .prepare<[number], ServerRow>(
      `SELECT id, user_id AS userId, name, config, created_at AS createdAt
       FROM user_mcp_servers WHERE user_id = ? ORDER BY created_at`
    )
    .all(userId)
    .map((row) => ({
      ...row,
      config: JSON.parse(row.config),
    }));
}

export function getUserMcpServer(id: number, userId: number): UserMcpServer | null {
  const row = getDb()
    .prepare<[number, number], ServerRow>(
      `SELECT id, user_id AS userId, name, config, created_at AS createdAt
       FROM user_mcp_servers WHERE id = ? AND user_id = ?`
    )
    .get(id, userId);
  if (!row) return null;
  return { ...row, config: JSON.parse(row.config) };
}

export function addUserMcpServer(
  userId: number,
  name: string,
  config: Record<string, unknown>
): number {
  const result = getDb()
    .prepare(`INSERT INTO user_mcp_servers (user_id, name, config, created_at) VALUES (?, ?, ?, ?)`)
    .run(userId, name, JSON.stringify(config), new Date().toISOString());
  return Number(result.lastInsertRowid);
}

export function updateUserMcpServer(
  id: number,
  userId: number,
  name: string,
  config: Record<string, unknown>
): boolean {
  const result = getDb()
    .prepare(`UPDATE user_mcp_servers SET name = ?, config = ? WHERE id = ? AND user_id = ?`)
    .run(name, JSON.stringify(config), id, userId);
  return result.changes > 0;
}

export function deleteUserMcpServer(id: number, userId: number): boolean {
  return getDb().transaction(() => {
    getDb()
      .prepare(
        `DELETE FROM user_mcp_inputs
         WHERE server_id IN (SELECT id FROM user_mcp_servers WHERE id = ? AND user_id = ?)`
      )
      .run(id, userId);
    const result = getDb()
      .prepare(`DELETE FROM user_mcp_servers WHERE id = ? AND user_id = ?`)
      .run(id, userId);
    return result.changes > 0;
  })();
}

export function setUserMcpInput(serverId: number, inputId: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO user_mcp_inputs (server_id, input_id, value) VALUES (?, ?, ?)
       ON CONFLICT(server_id, input_id) DO UPDATE SET value = excluded.value`
    )
    .run(serverId, inputId, value);
}

export function getUserMcpInputs(serverId: number): Record<string, string> {
  const rows = getDb()
    .prepare<[number], { inputId: string; value: string }>(
      `SELECT input_id AS inputId, value FROM user_mcp_inputs WHERE server_id = ?`
    )
    .all(serverId);
  return Object.fromEntries(rows.map((r) => [r.inputId, r.value]));
}

export function getAllUserMcpServers(): UserMcpServer[] {
  return getDb()
    .prepare<[], ServerRow>(
      `SELECT id, user_id AS userId, name, config, created_at AS createdAt
       FROM user_mcp_servers ORDER BY user_id, created_at`
    )
    .all()
    .map((row) => ({
      ...row,
      config: JSON.parse(row.config),
    }));
}

export interface UserConfigService {
  get(userId: number): UserConfig;
  set(userId: number, config: UserConfig): void;
  listMcpServers(userId: number): UserMcpServer[];
  getMcpServer(id: number, userId: number): UserMcpServer | null;
  addMcpServer(userId: number, name: string, config: Record<string, unknown>): number;
  updateMcpServer(
    id: number,
    userId: number,
    name: string,
    config: Record<string, unknown>
  ): boolean;
  deleteMcpServer(id: number, userId: number): boolean;
  setMcpInput(serverId: number, inputId: string, value: string): void;
  getMcpInputs(serverId: number): Record<string, string>;
  listAllMcpServers(): UserMcpServer[];
}

export const userConfigService: UserConfigService = {
  get: getUserConfig,
  set: setUserConfig,
  listMcpServers: getUserMcpServers,
  getMcpServer: getUserMcpServer,
  addMcpServer: addUserMcpServer,
  updateMcpServer: updateUserMcpServer,
  deleteMcpServer: deleteUserMcpServer,
  setMcpInput: setUserMcpInput,
  getMcpInputs: getUserMcpInputs,
  listAllMcpServers: getAllUserMcpServers,
};
