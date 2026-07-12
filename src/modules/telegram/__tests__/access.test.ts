import { describe, expect, test, vi } from "vitest";
import { hasMeteredAccess, type AccessDeps } from "../access.js";

function deps(active: boolean): AccessDeps {
  return {
    billing: {
      getAccount: vi.fn().mockReturnValue({}),
      hasActiveSub: vi.fn().mockReturnValue(active),
    } as unknown as AccessDeps["billing"],
    admin: {} as AccessDeps["admin"],
  };
}

describe("hasMeteredAccess", () => {
  test("does not meter free access without a subscription", () => {
    expect(hasMeteredAccess(deps(false), 42)).toBe(false);
  });

  test("meters users with an active subscription", () => {
    expect(hasMeteredAccess(deps(true), 42)).toBe(true);
  });
});
