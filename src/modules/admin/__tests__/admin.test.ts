import { test, expect, describe, beforeEach } from "vitest";
import { AdminService } from "../service.js";
import { getDb } from "../../../core/db.js";

beforeEach(() => {
  getDb().exec("DELETE FROM admin_allowlist; DELETE FROM admin_banlist;");
});

describe("AdminService", () => {
  test("isAdmin checks the configured set", () => {
    const s = new AdminService(new Set([1, 2]));
    expect(s.isAdmin(1)).toBe(true);
    expect(s.isAdmin(3)).toBe(false);
  });

  test("allows and disallows chats/users", () => {
    const s = new AdminService(new Set([1]));
    expect(s.isAllowed(-100)).toBe(false);
    s.allow(-100, "group", 1);
    expect(s.isAllowed(-100)).toBe(true);
    const list = s.listAllowed();
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("group");
    expect(s.disallow(-100)).toBe(true);
    expect(s.isAllowed(-100)).toBe(false);
  });

  test("banning removes from allowlist and blocks", () => {
    const s = new AdminService(new Set([1]));
    s.allow(42, "user", 1);
    expect(s.isAllowed(42)).toBe(true);
    s.ban(42, 1);
    expect(s.isAllowed(42)).toBe(false);
    expect(s.isBanned(42)).toBe(true);
    s.unban(42);
    expect(s.isBanned(42)).toBe(false);
  });

  test("seedAllowlist idempotently inserts entries", () => {
    const s = new AdminService(new Set([1]));
    s.seedAllowlist([-100, 42, 42]);
    expect(s.listAllowed()).toHaveLength(2);
    s.seedAllowlist([-100]);
    expect(s.listAllowed()).toHaveLength(2);
  });
});