import { describe, expect, it } from "vitest";
import { sandboxEnvSchema } from "../env.js";

describe("sandbox env schema", () => {
  it("parses defaults", () => {
    const parsed = sandboxEnvSchema.parse({});
    expect(parsed.SANDBOX_ENABLED).toBe(true);
    expect(parsed.SANDBOX_RUNTIME).toBe("node24");
    expect(parsed.SANDBOX_TIMEOUT_MS).toBe(300000);
    expect(parsed.SANDBOX_VCPUS).toBe(2);
    expect(parsed.SANDBOX_PERSISTENT).toBe(false);
    expect(parsed.SANDBOX_COMMAND_TIMEOUT_MS).toBe(60000);
  });

  it("parses boolean flags from strings", () => {
    const parsed = sandboxEnvSchema.parse({
      SANDBOX_ENABLED: "false",
      SANDBOX_PERSISTENT: "1",
    });
    expect(parsed.SANDBOX_ENABLED).toBe(false);
    expect(parsed.SANDBOX_PERSISTENT).toBe(true);
  });

  it("parses numeric values from strings", () => {
    const parsed = sandboxEnvSchema.parse({
      SANDBOX_TIMEOUT_MS: "600000",
      SANDBOX_VCPUS: "4",
      SANDBOX_COMMAND_TIMEOUT_MS: "120000",
    });
    expect(parsed.SANDBOX_TIMEOUT_MS).toBe(600000);
    expect(parsed.SANDBOX_VCPUS).toBe(4);
    expect(parsed.SANDBOX_COMMAND_TIMEOUT_MS).toBe(120000);
  });

  it("captures Vercel credentials when present", () => {
    const parsed = sandboxEnvSchema.parse({
      VERCEL_ACCESS_TOKEN: "tok_xxx",
      VERCEL_PROJECT_ID: "prj_xxx",
      VERCEL_TEAM_ID: "team_xxx",
    });
    expect(parsed.VERCEL_ACCESS_TOKEN).toBe("tok_xxx");
    expect(parsed.VERCEL_PROJECT_ID).toBe("prj_xxx");
    expect(parsed.VERCEL_TEAM_ID).toBe("team_xxx");
  });
});
