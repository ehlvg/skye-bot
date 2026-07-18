import { test, expect, describe, beforeEach } from "vitest";
import { AdminService } from "../service.js";
import { getDb } from "../../../core/db.js";

beforeEach(() => {
  getDb().exec(
    "DELETE FROM admin_allowlist; DELETE FROM admin_banlist; DELETE FROM admin_principals;"
  );
});

describe("AdminService", () => {
  test("keeps the configured owner and config admins protected", () => {
    const service = new AdminService({ ownerId: 1, configuredAdminIds: new Set([2]) });
    expect(service.isOwner(1)).toBe(true);
    expect(service.isAdmin(1)).toBe(true);
    expect(service.isAdmin(2)).toBe(true);
    expect(service.removeAdmin(1)).toBe("protected");
    expect(service.removeAdmin(2)).toBe("protected");
  });

  test("uses the first legacy config admin as owner when owner.user_id is unset", () => {
    const service = new AdminService({ configuredAdminIds: new Set([7, 8]) });
    expect(service.isOwner(7)).toBe(true);
    expect(service.isAdmin(8)).toBe(true);
  });

  test("supports a one-time owner claim", () => {
    const service = new AdminService();
    const token = service.bootstrapTokenForLogs();
    expect(token).toBeTruthy();
    expect(service.claimOwner(42, "wrong")).toBe(false);
    expect(service.claimOwner(42, token!)).toBe(true);
    expect(service.isOwner(42)).toBe(true);
    expect(service.claimOwner(43, token!)).toBe(false);
  });

  test("adds and removes delegated administrators", () => {
    const service = new AdminService({ ownerId: 1 });
    expect(service.addAdmin(2, 1)).toBe(true);
    expect(service.isAdmin(2)).toBe(true);
    expect(service.removeAdmin(2)).toBe("removed");
    expect(service.isAdmin(2)).toBe(false);
  });

  test("allows and disallows chats/users", () => {
    const service = new AdminService({ ownerId: 1 });
    expect(service.isAllowed(-100)).toBe(false);
    service.allow(-100, "group", 1);
    expect(service.isAllowed(-100)).toBe(true);
    expect(service.listAllowed()).toHaveLength(1);
    expect(service.disallow(-100)).toBe(true);
  });

  test("does not allow administrators to be banned", () => {
    const service = new AdminService({ ownerId: 1 });
    expect(service.ban(1, 1)).toBe(false);
    expect(service.isBanned(1)).toBe(false);
    service.allow(42, "user", 1);
    expect(service.ban(42, 1)).toBe(true);
    expect(service.isAllowed(42)).toBe(false);
    expect(service.isBanned(42)).toBe(true);
  });

  test("seedAllowlist idempotently inserts entries", () => {
    const service = new AdminService({ ownerId: 1 });
    service.seedAllowlist([-100, 42, 42]);
    expect(service.listAllowed()).toHaveLength(2);
    service.seedAllowlist([-100]);
    expect(service.listAllowed()).toHaveLength(2);
  });
});
