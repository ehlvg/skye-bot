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

interface AllowRow {
  id: number;
  target_id: number;
  kind: string;
  added_by: number;
  note: string | null;
  created_at: string;
}

export class AdminService {
  constructor(private readonly adminIds: Set<number>) {}

  isAdmin(userId?: number): boolean {
    return !!userId && this.adminIds.has(userId);
  }

  /** Anyone configured as an admin is implicitly allowed to use the bot. */
  listAdminIds(): number[] {
    return [...this.adminIds];
  }

  isBanned(targetId: number): boolean {
    const row = getDb()
      .prepare<[number], { target_id: number }>(
        "SELECT target_id FROM admin_banlist WHERE target_id = ?"
      )
      .get(targetId);
    return !!row;
  }

  ban(targetId: number, bannedBy: number): void {
    // A banned id is implicitly no-longer allowed.
    this.disallow(targetId);
    getDb()
      .prepare(
        "INSERT INTO admin_banlist (target_id, banned_by, created_at) VALUES (?, ?, ?) ON CONFLICT(target_id) DO NOTHING"
      )
      .run(targetId, bannedBy, new Date().toISOString());
  }

  unban(targetId: number): boolean {
    const r = getDb()
      .prepare("DELETE FROM admin_banlist WHERE target_id = ?")
      .run(targetId);
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
    const r = getDb()
      .prepare("DELETE FROM admin_allowlist WHERE target_id = ?")
      .run(targetId);
    return r.changes > 0;
  }

  isAllowed(targetId: number): boolean {
    const row = getDb()
      .prepare<[number], { target_id: number }>(
        "SELECT target_id FROM admin_allowlist WHERE target_id = ?"
      )
      .get(targetId);
    return !!row;
  }

  listAllowed(): AllowEntry[] {
    const rows = getDb()
      .prepare<[], AllowRow>(
        "SELECT id, target_id, kind, added_by, note, created_at FROM admin_allowlist ORDER BY created_at"
      )
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
             VALUES (?, ?, 0, 'seeded from ALLOWED_IDS', ?)`
          )
          .run(id, id < 0 ? "group" : "user", new Date().toISOString());
      }
    });
    tx(ids);
  }
}