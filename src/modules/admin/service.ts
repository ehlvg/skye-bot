import { randomBytes, timingSafeEqual } from "crypto";
import { getDb } from "../../core/db.js";

export type AllowKind = "user" | "group" | "channel";

export interface AllowEntry {
  id: number;
  targetId: number;
  kind: AllowKind;
  addedBy: number;
  note: string | null;
  createdAt: string;
}

export interface AdminPrincipal {
  userId: number;
  role: "owner" | "admin";
  source: "config" | "database";
  removable: boolean;
  addedBy: number | null;
  createdAt: string | null;
}

interface AllowRow {
  id: number;
  target_id: number;
  kind: string;
  added_by: number;
  note: string | null;
  created_at: string;
}

interface PrincipalRow {
  user_id: number;
  role: "owner" | "admin";
  added_by: number;
  source: string;
  created_at: string;
}

export interface AdminServiceOptions {
  ownerId?: number;
  configuredAdminIds?: Set<number>;
}

export type RemoveAdminResult = "removed" | "not_found" | "protected";

export class AdminService {
  private readonly configuredAdminIds: Set<number>;
  private ownerId?: number;
  private bootstrapToken?: string;

  constructor(options: AdminServiceOptions = {}) {
    this.configuredAdminIds = new Set(options.configuredAdminIds ?? []);
    const configuredOwner =
      options.ownerId && options.ownerId > 0
        ? options.ownerId
        : this.configuredAdminIds.values().next().value;

    if (configuredOwner) {
      this.setConfiguredOwner(configuredOwner);
      this.configuredAdminIds.delete(configuredOwner);
    } else {
      this.ownerId = this.readOwnerId();
      if (!this.ownerId) this.bootstrapToken = randomBytes(24).toString("base64url");
    }
  }

  private readOwnerId(): number | undefined {
    return getDb()
      .prepare<
        [],
        { user_id: number }
      >("SELECT user_id FROM admin_principals WHERE role = 'owner' LIMIT 1")
      .get()?.user_id;
  }

  private setConfiguredOwner(userId: number): void {
    const now = new Date().toISOString();
    getDb().transaction(() => {
      getDb()
        .prepare("DELETE FROM admin_principals WHERE role = 'owner' AND user_id <> ?")
        .run(userId);
      getDb()
        .prepare(
          `INSERT INTO admin_principals (user_id, role, added_by, source, created_at)
           VALUES (?, 'owner', ?, 'config', ?)
           ON CONFLICT(user_id) DO UPDATE SET role = 'owner', source = 'config'`
        )
        .run(userId, userId, now);
    })();
    this.ownerId = userId;
    this.bootstrapToken = undefined;
  }

  ownerUserId(): number | undefined {
    return this.ownerId;
  }

  ownerClaimRequired(): boolean {
    return !this.ownerId;
  }

  bootstrapTokenForLogs(): string | undefined {
    return this.bootstrapToken;
  }

  claimOwner(userId: number, token: string): boolean {
    if (this.ownerId || !this.bootstrapToken || !Number.isSafeInteger(userId) || userId <= 0) {
      return false;
    }
    const expected = Buffer.from(this.bootstrapToken);
    const supplied = Buffer.from(token);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return false;

    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO admin_principals (user_id, role, added_by, source, created_at)
         VALUES (?, 'owner', ?, 'bootstrap', ?)`
      )
      .run(userId, userId, now);
    this.ownerId = userId;
    this.bootstrapToken = undefined;
    return true;
  }

  isOwner(userId?: number): boolean {
    return !!userId && userId === this.ownerId;
  }

  isAdmin(userId?: number): boolean {
    if (!userId) return false;
    if (this.isOwner(userId) || this.configuredAdminIds.has(userId)) return true;
    return Boolean(
      getDb()
        .prepare<
          [number],
          { user_id: number }
        >("SELECT user_id FROM admin_principals WHERE user_id = ? AND role = 'admin'")
        .get(userId)
    );
  }

  listAdminIds(): number[] {
    return this.listAdmins().map((entry) => entry.userId);
  }

  listAdmins(): AdminPrincipal[] {
    const rows = getDb()
      .prepare<
        [],
        PrincipalRow
      >("SELECT user_id, role, added_by, source, created_at FROM admin_principals ORDER BY role DESC, created_at")
      .all();
    const byId = new Map<number, AdminPrincipal>();
    for (const row of rows) {
      byId.set(row.user_id, {
        userId: row.user_id,
        role: row.role,
        source: "database",
        removable: row.role === "admin" && !this.configuredAdminIds.has(row.user_id),
        addedBy: row.added_by,
        createdAt: row.created_at,
      });
    }
    for (const userId of this.configuredAdminIds) {
      byId.set(userId, {
        userId,
        role: "admin",
        source: "config",
        removable: false,
        addedBy: null,
        createdAt: null,
      });
    }
    return [...byId.values()].sort((a, b) => {
      if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
      return a.userId - b.userId;
    });
  }

  addAdmin(userId: number, addedBy: number): boolean {
    if (!Number.isSafeInteger(userId) || userId <= 0 || this.isAdmin(userId)) return false;
    const result = getDb()
      .prepare(
        `INSERT INTO admin_principals (user_id, role, added_by, source, created_at)
         VALUES (?, 'admin', ?, 'runtime', ?)`
      )
      .run(userId, addedBy, new Date().toISOString());
    return result.changes > 0;
  }

  removeAdmin(userId: number): RemoveAdminResult {
    if (this.isOwner(userId) || this.configuredAdminIds.has(userId)) return "protected";
    const result = getDb()
      .prepare("DELETE FROM admin_principals WHERE user_id = ? AND role = 'admin'")
      .run(userId);
    return result.changes > 0 ? "removed" : "not_found";
  }

  isBanned(targetId: number): boolean {
    const row = getDb()
      .prepare<
        [number],
        { target_id: number }
      >("SELECT target_id FROM admin_banlist WHERE target_id = ?")
      .get(targetId);
    return !!row;
  }

  ban(targetId: number, bannedBy: number): boolean {
    if (this.isAdmin(targetId)) return false;
    this.disallow(targetId);
    getDb()
      .prepare(
        "INSERT INTO admin_banlist (target_id, banned_by, created_at) VALUES (?, ?, ?) ON CONFLICT(target_id) DO NOTHING"
      )
      .run(targetId, bannedBy, new Date().toISOString());
    return true;
  }

  unban(targetId: number): boolean {
    const r = getDb().prepare("DELETE FROM admin_banlist WHERE target_id = ?").run(targetId);
    return r.changes > 0;
  }

  allow(targetId: number, kind: AllowKind, addedBy: number, note?: string): boolean {
    const r = getDb()
      .prepare(
        `INSERT INTO admin_allowlist (target_id, kind, added_by, note, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(target_id) DO UPDATE SET kind = excluded.kind, added_by = excluded.added_by, note = excluded.note`
      )
      .run(targetId, kind, addedBy, note ?? null, new Date().toISOString());
    return r.changes > 0;
  }

  disallow(targetId: number): boolean {
    const r = getDb().prepare("DELETE FROM admin_allowlist WHERE target_id = ?").run(targetId);
    return r.changes > 0;
  }

  isAllowed(targetId: number): boolean {
    const row = getDb()
      .prepare<
        [number],
        { target_id: number }
      >("SELECT target_id FROM admin_allowlist WHERE target_id = ?")
      .get(targetId);
    return !!row;
  }

  listAllowed(): AllowEntry[] {
    const rows = getDb()
      .prepare<
        [],
        AllowRow
      >("SELECT id, target_id, kind, added_by, note, created_at FROM admin_allowlist ORDER BY created_at")
      .all();
    return rows.map((r) => ({
      id: r.id,
      targetId: r.target_id,
      kind: r.kind as AllowKind,
      addedBy: r.added_by,
      note: r.note,
      createdAt: r.created_at,
    }));
  }

  seedAllowlist(ids: number[]): void {
    const tx = getDb().transaction((list: number[]) => {
      for (const id of list) {
        getDb()
          .prepare(
            `INSERT OR IGNORE INTO admin_allowlist (target_id, kind, added_by, note, created_at)
             VALUES (?, ?, 0, 'seeded from allowed_ids', ?)`
          )
          .run(id, id < 0 ? "group" : "user", new Date().toISOString());
      }
    });
    tx(ids);
  }
}
